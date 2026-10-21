package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID
import org.eclipse.microprofile.config.inject.ConfigProperty

data class LimitSettings(val maxPagesPerCanvas: Int, val maxOwnedCanvasesPerUser: Int)
data class StorageUsage(val elements: Long, val assets: Long)

@ApplicationScoped
class CanvasLimits @Inject constructor(
    @ConfigProperty(name = "team-canvas.max-pages", defaultValue = "10") val maxPages: Int = 10,
    @ConfigProperty(name = "team-canvas.max-owned-canvases", defaultValue = "20") val maxOwned: Int = 20,
) {
    init { require(maxPages > 0 && maxOwned > 0) { "Canvas limits must be positive" } }
    fun settings() = LimitSettings(maxPages, maxOwned)

    /** Serialize creation for the account; invitation memberships consume no quota. */
    fun requireOwnedSlot(c: Connection, userId: UUID) {
        c.query("SELECT id FROM app_users WHERE id=? FOR UPDATE", userId) { it.next() }
        val count = c.query("SELECT count(*) FROM boards WHERE owner_user_id=?", userId) { it.next(); it.getInt(1) }
        if (count >= maxOwned) throw ClientException("limit", "You can own at most $maxOwned canvases, including templates.")
    }

    fun requirePageSlot(count: Int) {
        if (count >= maxPages) throw ClientException("limit", "A canvas can have at most $maxPages pages.")
    }

    fun usage(c: Connection, boardId: UUID): StorageUsage = StorageUsage(
        c.query("SELECT coalesce(sum(stored_bytes),0) FROM elements WHERE board_id=?", boardId) { it.next(); it.getLong(1) },
        c.query("SELECT coalesce(sum(stored_bytes),0) FROM assets WHERE board_id=?", boardId) { it.next(); it.getLong(1) },
    )

    fun requireStorage(c: Connection, boardId: UUID, previous: StorageUsage = StorageUsage(0, 0)) {
        val now = usage(c, boardId)
        if ((now.elements > 20_000_000 && now.elements > previous.elements) ||
            (now.assets > 128_000_000 && now.assets > previous.assets))
            throw ClientException("limit", "Canvas storage limit reached. Remove content before adding more.")
    }
}
