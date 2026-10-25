package dev.teamcanvas

import java.sql.Connection
import java.util.UUID

data class AdminAuditEvent(
    val id: Long, val actorId: UUID?, val targetId: UUID?, val boardId: UUID?,
    val action: String, val result: String, val createdAt: String,
)

/** Security metadata only. Foreign keys scrub erased identities; no replacement-owner mapping. */
object AdminAudit {
    fun record(c: Connection, actor: UUID, target: UUID, action: String, result: String, board: UUID? = null) {
        val safeAction = action.takeIf { it in setOf("deactivate", "reactivate", "anonymize", "delete", "reassign") } ?: "invalid_action"
        c.update("""INSERT INTO admin_audit_events(actor_id,target_id,board_id,action,result)
            VALUES((SELECT id FROM app_users WHERE id=?),(SELECT id FROM app_users WHERE id=?),
            (SELECT id FROM boards WHERE id=?),?,?)""", actor, target, board, safeAction, result)
    }

    // Hard retention limit for API visibility; maintenance deletes expired rows in bounded batches.
    fun list(c: Connection): List<AdminAuditEvent> = c.query("""SELECT id,actor_id,target_id,board_id,action,result,created_at
        FROM admin_audit_events WHERE created_at>=now()-interval '90 days' ORDER BY id DESC LIMIT 100""") { r ->
        buildList { while (r.next()) add(AdminAuditEvent(
            r.getLong(1), r.getObject(2, UUID::class.java), r.getObject(3, UUID::class.java),
            r.getObject(4, UUID::class.java), r.getString(5), r.getString(6), r.getTimestamp(7).toInstant().toString(),
        )) }
    }

    fun cleanup(c: Connection): Int = c.update("""DELETE FROM admin_audit_events WHERE id IN
        (SELECT id FROM admin_audit_events WHERE created_at<now()-interval '90 days' ORDER BY created_at,id LIMIT 500)""")
}
