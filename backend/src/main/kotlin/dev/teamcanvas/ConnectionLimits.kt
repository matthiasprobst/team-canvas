package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import io.quarkus.runtime.Startup
import jakarta.inject.Inject
import org.eclipse.microprofile.config.inject.ConfigProperty

/** Per-canvas tabs/sockets; membership and the server/account budgets are separate. */
@ApplicationScoped
@Startup
class ConnectionLimits @Inject constructor(
    @ConfigProperty(name = "team-canvas.max-connections-per-canvas", defaultValue = "30")
    val maxPerCanvas: Int,
) {
    init {
        require(maxPerCanvas in 1..BoardLimits.CONNECTIONS) {
            "Maximum connections per canvas must be between 1 and ${BoardLimits.CONNECTIONS}"
        }
    }

    /** Call under the canvas lock so concurrent admissions cannot exceed the limit. */
    fun requireSlot(occupied: Int) {
        if (occupied >= maxPerCanvas)
            throw ClientException("room_full", "A canvas supports at most $maxPerCanvas active connections.")
    }
}
