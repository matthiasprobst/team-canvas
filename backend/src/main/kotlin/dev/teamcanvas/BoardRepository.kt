package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID
import javax.sql.DataSource

@ApplicationScoped
class BoardRepository @Inject constructor(private val dataSource: DataSource, val limits: CanvasLimits = CanvasLimits()) {
    fun <T> transaction(action: (Connection) -> T): T =
        dataSource.connection.use { connection ->
            connection.autoCommit = false
            try {
                connection.createStatement().use {
                    it.execute("SET LOCAL statement_timeout = '10s'")
                }
                val result = action(connection)
                connection.commit()
                result
            } catch (error: Exception) {
                try {
                    connection.rollback()
                } catch (rollbackError: Exception) {
                    error.addSuppressed(rollbackError)
                }
                throw error
            }
        }

    /** Commands and snapshots use the same database lock, including HTTP asset reads. */
    fun board(connection: Connection, id: UUID): BoardState =
        connection
            .prepareStatement(
                "SELECT id,name,mode,current_round_id,epoch,revision,current_page_id FROM boards WHERE id=? FOR UPDATE"
            )
            .use { statement ->
                statement.setObject(1, id)
                statement.executeQuery().use { rows ->
                    if (!rows.next())
                        throw ClientException(
                            "not_found",
                            "Canvas not found or access is unavailable.",
                        )
                    BoardState(
                        id,
                        rows.getString("name"),
                        rows.getString("mode"),
                        rows.getObject("current_round_id", UUID::class.java),
                        rows.getLong("epoch"),
                        rows.getLong("revision"),
                        rows.getObject("current_page_id", UUID::class.java),
                    )
                }
            }

    fun requireActive(connection: Connection, who: Participant) {
        val active =
            connection
                .prepareStatement(
                    """SELECT 1 FROM participants p JOIN board_sessions s ON s.participant_id=p.id
                    JOIN login_sessions l ON l.user_id=s.user_id AND l.sid=s.sid
                    JOIN app_users u ON u.id=s.user_id
                    WHERE p.id=? AND p.board_id=? AND p.revoked=false AND s.token_hash=?
                    AND s.revoked=false AND s.expires_at>now() AND l.revoked=false AND u.status='active' FOR SHARE OF l,s,p,u"""
                )
                .use { statement ->
                    statement.setObject(1, who.id)
                    statement.setObject(2, who.boardId)
                    statement.setString(3, who.sessionHash)
                    statement.executeQuery().use { it.next() }
                }
        if (!active) throw ClientException("unauthorized", "Access expired or was revoked.")
    }

    fun round(state: BoardState): RoundState? = state.roundId?.let { RoundState(it) }

    fun pages(connection: Connection, boardId: UUID): List<CanvasSheet> =
        connection.prepareStatement("SELECT id,position FROM canvas_pages WHERE board_id=? ORDER BY position").use {
            it.setObject(1, boardId)
            it.executeQuery().use { rows -> buildList {
                while (rows.next()) add(CanvasSheet(rows.getObject(1, UUID::class.java), rows.getInt(2)))
            } }
        }

    private fun receiptScope(who: Participant, roundId: UUID?): String =
        if (roundId == null) "public" else DraftCapabilities.hash(who, roundId)
            ?: throw ClientException("locked", "Private draft capability is missing.")

    fun receipt(c: Connection, who: Participant, id: UUID, roundId: UUID? = null): CommandAck? =
        c.query("SELECT revision FROM command_receipts WHERE board_id=? AND receipt_scope=? AND command_id=?",
            who.boardId, receiptScope(who, roundId), id) {
            if (it.next()) CommandAck(commandId = id, revision = it.getLong(1)) else null
        }

    fun commitCommand(c: Connection, who: Participant, id: UUID, roundId: UUID? = null,
                      completingRound: Boolean = false): CommandAck {
        c.update("DELETE FROM command_receipts WHERE board_id=? AND created_at<now()-interval '2 days'", who.boardId)
        val count = c.query("SELECT count(*) FROM command_receipts WHERE board_id=? AND created_at>now()-interval '1 day'", who.boardId) { it.next(); it.getLong(1) }
        // A real reveal must still finish when its start consumed the final slot.
        // Only that transition bypasses the budget: new starts and no-op controls
        // remain limited, so clients cannot mint unlimited completion receipts.
        if (count >= BoardLimits.COMMANDS_PER_DAY && !completingRound)
            throw ClientException("daily_limit", "Daily canvas change limit reached.")
        val revision = c.query("UPDATE boards SET revision=revision+1 WHERE id=? RETURNING revision", who.boardId) { it.next(); it.getLong(1) }
        c.update("INSERT INTO command_receipts(board_id,receipt_scope,command_id,revision) VALUES(?,?,?,?)",
            who.boardId, receiptScope(who, roundId), id, revision)
        return CommandAck(commandId = id, revision = revision)
    }

    fun <T> command(who: Participant, action: (Connection, BoardState) -> T): T =
        transaction { connection ->
            val state = board(connection, who.boardId)
            requireActive(connection, who)
            action(connection, state)
        }
}
