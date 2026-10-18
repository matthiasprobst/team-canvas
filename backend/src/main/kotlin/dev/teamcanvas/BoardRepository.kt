package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID
import javax.sql.DataSource

@ApplicationScoped
class BoardRepository @Inject constructor(private val dataSource: DataSource) {
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
                connection.rollback()
                throw error
            }
        }

    /** Commands and snapshots use the same database lock, including HTTP asset reads. */
    fun board(connection: Connection, id: UUID): BoardState =
        connection
            .prepareStatement(
                "SELECT id,name,mode,current_round_id,epoch,revision FROM boards WHERE id=? FOR UPDATE"
            )
            .use { statement ->
                statement.setObject(1, id)
                statement.executeQuery().use { rows ->
                    if (!rows.next()) throw ClientException("not_found", "Board existiert nicht")
                    BoardState(
                        id,
                        rows.getString("name"),
                        rows.getString("mode"),
                        rows.getObject("current_round_id", UUID::class.java),
                        rows.getLong("epoch"),
                        rows.getLong("revision"),
                    )
                }
            }

    fun requireActive(connection: Connection, who: Participant) {
        val active =
            connection
                .prepareStatement(
                    "SELECT 1 FROM participants WHERE id=? AND board_id=? AND revoked=false AND expires_at>now()"
                )
                .use { statement ->
                    statement.setObject(1, who.id)
                    statement.setObject(2, who.boardId)
                    statement.executeQuery().use { it.next() }
                }
        if (!active) throw ClientException("unauthorized", "Zugang abgelaufen oder widerrufen")
    }

    fun round(connection: Connection, state: BoardState, who: Participant): RoundState? {
        val id = state.roundId ?: return null
        val members =
            connection
                .prepareStatement(
                    """
                    SELECT p.id,p.name,rp.done FROM round_participants rp
                    JOIN participants p ON p.id=rp.participant_id WHERE rp.round_id=? ORDER BY p.id
                    """
                        .trimIndent()
                )
                .use { statement ->
                    statement.setObject(1, id)
                    statement.executeQuery().use { rows ->
                        buildList {
                            while (rows.next()) add(
                                RoundMember(
                                    rows.getObject(1, UUID::class.java),
                                    rows.getString(2),
                                    rows.getBoolean(3),
                                )
                            )
                        }
                    }
                }
        val revision =
            connection
                .prepareStatement(
                    "SELECT draft_revision FROM round_participants WHERE round_id=? AND participant_id=?"
                )
                .use { statement ->
                    statement.setObject(1, id)
                    statement.setObject(2, who.id)
                    statement.executeQuery().use { if (it.next()) it.getLong(1) else 0L }
                }
        val member = members.find { it.id == who.id }
        return RoundState(id, member?.done ?: false, member != null, revision, members)
    }

    fun receipt(connection: Connection, who: Participant, id: UUID): CommandAck? =
        connection
            .prepareStatement(
                "SELECT revision FROM command_receipts WHERE participant_id=? AND command_id=?"
            )
            .use { statement ->
                statement.setObject(1, who.id)
                statement.setObject(2, id)
                statement.executeQuery().use {
                    if (it.next()) CommandAck(commandId = id, revision = it.getLong(1)) else null
                }
            }

    fun commitCommand(connection: Connection, who: Participant, id: UUID): CommandAck {
        connection
            .prepareStatement(
                "DELETE FROM command_receipts WHERE participant_id=? AND created_at<now()-interval '2 days'"
            )
            .use {
                it.setObject(1, who.id)
                it.executeUpdate()
            }
        val count =
            connection
                .prepareStatement(
                    "SELECT count(*) FROM command_receipts WHERE participant_id=? AND created_at>now()-interval '1 day'"
                )
                .use {
                    it.setObject(1, who.id)
                    it.executeQuery().use { rows ->
                        rows.next()
                        rows.getLong(1)
                    }
                }
        if (count >= 50_000)
            throw ClientException("daily_limit", "Tageslimit für Änderungen erreicht")
        val revision =
            connection
                .prepareStatement(
                    "UPDATE boards SET revision=revision+1 WHERE id=? RETURNING revision"
                )
                .use {
                    it.setObject(1, who.boardId)
                    it.executeQuery().use { rows ->
                        rows.next()
                        rows.getLong(1)
                    }
                }
        connection
            .prepareStatement(
                "INSERT INTO command_receipts(participant_id,command_id,revision) VALUES(?,?,?)"
            )
            .use {
                it.setObject(1, who.id)
                it.setObject(2, id)
                it.setLong(3, revision)
                it.executeUpdate()
            }
        return CommandAck(commandId = id, revision = revision)
    }

    fun <T> command(who: Participant, action: (Connection, BoardState) -> T): T =
        transaction { connection ->
            val state = board(connection, who.boardId)
            requireActive(connection, who)
            action(connection, state)
        }
}
