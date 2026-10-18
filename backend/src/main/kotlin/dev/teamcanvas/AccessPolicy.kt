package dev.teamcanvas

import io.vertx.core.http.HttpServerRequest
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import jakarta.ws.rs.container.ContainerRequestContext
import jakarta.ws.rs.container.ContainerRequestFilter
import jakarta.ws.rs.ext.Provider
import java.security.Principal
import org.eclipse.microprofile.config.inject.ConfigProperty

@ApplicationScoped
class AccessPolicy {
    @ConfigProperty(name = "team-canvas.auth-required", defaultValue = "true")
    var authRequired: Boolean = true

    @ConfigProperty(
        name = "team-canvas.allowed-origins",
        defaultValue = "http://localhost:8088,http://localhost:5173",
    )
    lateinit var origins: String

    fun subject(principal: Principal?): String? {
        // Explicit local guest mode must not bind sessions to container-specific anonymous
        // principals, which can differ between the HTTP join and WebSocket upgrade requests.
        if (!authRequired) return null
        val subject = principal?.name
        if (subject.isNullOrBlank())
            throw ClientException("unauthorized", "Bitte mit dem Firmenkonto anmelden")
        if (subject.length > 512) throw ClientException("unauthorized", "Ungültige Identität")
        return subject
    }

    fun allowsOrigin(origin: String?): Boolean =
        if (origin.isNullOrBlank()) !authRequired
        else origins.split(',').map { it.trim() }.contains(origin)
}

/** Fixed windows with bounded cardinality; client input cannot grow this cache without bound. */
@ApplicationScoped
class RequestLimits {
    private data class Window(val until: Long, var count: Long)

    private val windows = mutableMapOf<String, Window>()

    @Synchronized
    fun require(key: String, maximum: Int, durationMs: Long = 1000, weight: Int = 1) {
        val now = System.currentTimeMillis()
        if (windows.size >= 4096) windows.entries.removeIf { it.value.until <= now }
        val window =
            windows[key]?.takeIf { it.until > now }
                ?: run {
                    if (windows.size >= 4096)
                        throw ClientException("rate_limit", "Zu viele Anfragen")
                    Window(now + durationMs, 0).also { windows[key] = it }
                }
        if (window.count + weight > maximum)
            throw ClientException("rate_limit", "Zu viele Anfragen. Bitte kurz warten.")
        window.count += weight
    }
}

@Provider
class RequestGuard
@Inject
constructor(
    private val policy: AccessPolicy,
    private val limits: RequestLimits,
    private val request: HttpServerRequest,
    private val writer: SingleWriterGuard,
) : ContainerRequestFilter {
    override fun filter(context: ContainerRequestContext) {
        if (!context.uriInfo.path.startsWith("api/boards")) return
        writer.requireOwner()
        val subject = policy.subject(context.securityContext.userPrincipal)
        if (
            context.method !in setOf("GET", "HEAD", "OPTIONS") &&
                !policy.allowsOrigin(context.getHeaderString("Origin"))
        )
            throw ClientException("forbidden", "Anfrage von fremder Herkunft abgelehnt")
        val client = subject ?: request.remoteAddress().host()
        limits.require("http:$client", 240, 60_000)
        if (context.method == "POST" && !context.uriInfo.path.endsWith("/invitations"))
            limits.require("join:$client", 30, 60_000)
    }
}
