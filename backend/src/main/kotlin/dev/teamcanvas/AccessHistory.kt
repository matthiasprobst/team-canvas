package dev.teamcanvas

import java.sql.Connection
import java.util.UUID

data class AccessEvent(val id: Long, val action: String, val actorName: String?, val targetName: String?, val targetId: UUID?, val createdAt: String)

internal fun recordAccess(c: Connection, boardId: UUID, actorId: UUID, action: String, targetId: UUID? = null) {
    c.update("INSERT INTO canvas_access_events(board_id,actor_id,target_id,action) VALUES(?,?,?,?)", boardId, actorId, targetId, action)
}
