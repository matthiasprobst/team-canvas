package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import jakarta.ws.rs.container.ContainerRequestContext
import jakarta.ws.rs.container.ContainerRequestFilter
import jakarta.ws.rs.ext.Provider
import org.eclipse.microprofile.config.inject.ConfigProperty

@ApplicationScoped
class AccessPolicy {
    @ConfigProperty(
        name = "team-canvas.allowed-origins",
        defaultValue = "http://localhost:8088,http://localhost:5173",
    )
    lateinit var origins: String

    fun allowsOrigin(origin: String?): Boolean =
        if (origin.isNullOrBlank()) false else origins.split(',').map { it.trim() }.contains(origin)
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
                        throw ClientException("rate_limit", "Too many requests.")
                    Window(now + durationMs, 0).also { windows[key] = it }
                }
        if (window.count + weight > maximum)
            throw ClientException("rate_limit", "Too many requests. Please wait a moment.")
        window.count += weight
    }
}

@Provider
class RequestGuard
@Inject
constructor(
    private val policy: AccessPolicy,
    private val limits: RequestLimits,
    private val writer: SingleWriterGuard,
) : ContainerRequestFilter {
    override fun filter(context: ContainerRequestContext) {
        val path = context.uriInfo.path.trimStart('/')
        if (
            path != "api/boards" &&
                !path.startsWith("api/boards/") &&
                !path.startsWith("api/admin/") &&
                path !in setOf("api/me", "api/logout")
        )
            return
        writer.requireOwner()
        val identity = loginIdentity(context.securityContext.userPrincipal)
        if (
            context.method !in setOf("GET", "HEAD", "OPTIONS") &&
                !policy.allowsOrigin(context.getHeaderString("Origin"))
        )
            throw ClientException("forbidden", "Request from an untrusted origin rejected.")
        val client = Security.hash(identity.issuer + "\n" + identity.subject)
        limits.require("http:$client", 240, 60_000)
        if (context.method == "POST" && (path == "api/boards" || path.endsWith("/join") || path.endsWith("/start-template")))
            limits.require("join:$client", 30, 60_000)
    }
}
