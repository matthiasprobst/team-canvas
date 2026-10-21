package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection

@ApplicationScoped
class ExpiredRecords @Inject constructor(private val repository: BoardRepository) {
    fun runBatch(): Int = repository.transaction { cleanup(it) }
    companion object {
        fun cleanup(c: Connection): Int {
            var removed = 0
            for ((table, condition) in listOf(
                "board_sessions" to "expires_at<now()",
                "board_invitations" to "revoked OR expires_at<now()",
                "command_receipts" to "created_at<now()-interval '2 days'",
            )) removed += c.update("DELETE FROM $table WHERE ctid IN (SELECT ctid FROM $table WHERE $condition LIMIT 500)")
            return removed
        }
    }
}
