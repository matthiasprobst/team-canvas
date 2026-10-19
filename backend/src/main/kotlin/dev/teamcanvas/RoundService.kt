package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

@ApplicationScoped
class RoundService @Inject constructor(private val repository: BoardRepository) {
    fun start(who: Participant, context: CommandContext, active: Set<UUID>): CommandResult =
        repository.command(who) command@{ connection, state ->
            RoundRules.requireHost(who)
            repository.receipt(connection, who, context.commandId)?.let {
                return@command CommandResult(it, duplicate = true)
            }
            RoundRules.requireContext(state, context)
            if (state.mode != "standard")
                throw ClientException("invalid_state", "A round is already in progress.")
            val id = UUID.randomUUID()
            connection
                .prepareStatement("INSERT INTO rounds(id,board_id,status) VALUES(?,?,'editing')")
                .use {
                    it.setObject(1, id)
                    it.setObject(2, who.boardId)
                    it.executeUpdate()
                }
            (active + who.id).forEach { participantId ->
                connection
                    .prepareStatement(
                        """INSERT INTO round_participants(round_id,participant_id)
                        SELECT ?,id FROM participants WHERE id=? AND board_id=? AND revoked=false AND user_id IS NOT NULL"""
                    )
                    .use {
                        it.setObject(1, id)
                        it.setObject(2, participantId)
                        it.setObject(3, who.boardId)
                        it.executeUpdate()
                    }
            }
            connection
                .prepareStatement(
                    "UPDATE boards SET mode='poker',current_round_id=?,epoch=epoch+1 WHERE id=?"
                )
                .use {
                    it.setObject(1, id)
                    it.setObject(2, who.boardId)
                    it.executeUpdate()
                }
            CommandResult(
                repository.commitCommand(connection, who, context.commandId),
                transitioned = true,
            )
        }

    fun ready(who: Participant, context: CommandContext, draftRevision: Long): CommandResult =
        repository.command(who) command@{ connection, state ->
            repository.receipt(connection, who, context.commandId)?.let {
                return@command CommandResult(it, duplicate = true)
            }
            RoundRules.requireContext(state, context)
            val round = repository.round(connection, state, who)
            if (round == null || !round.included)
                throw ClientException("locked", "You are not included in this round.")
            if (round.draftRevision != draftRevision)
                throw ClientException("unsaved_draft", "Save all changes before marking yourself ready.")
            connection
                .prepareStatement(
                    "UPDATE round_participants SET done=true WHERE round_id=? AND participant_id=?"
                )
                .use {
                    it.setObject(1, round.id)
                    it.setObject(2, who.id)
                    it.executeUpdate()
                }
            val reveal = RoundRules.allReady(repository.round(connection, state, who)!!.members)
            if (reveal) finish(connection, state, publish = true)
            CommandResult(
                repository.commitCommand(connection, who, context.commandId),
                transitioned = reveal,
            )
        }

    fun cancel(who: Participant, context: CommandContext): CommandResult =
        repository.command(who) command@{ connection, state ->
            RoundRules.requireHost(who)
            repository.receipt(connection, who, context.commandId)?.let {
                return@command CommandResult(it, duplicate = true)
            }
            RoundRules.requireContext(state, context)
            if (state.roundId == null) throw ClientException("invalid_state", "No active round.")
            finish(connection, state, publish = false)
            CommandResult(
                repository.commitCommand(connection, who, context.commandId),
                transitioned = true,
            )
        }

    private fun finish(connection: Connection, state: BoardState, publish: Boolean) {
        if (publish) {
            connection
                .prepareStatement(
                    """DELETE FROM elements WHERE board_id=? AND round_id=?
                AND scope='private' AND body->>'isDeleted'='true'"""
                )
                .use {
                    it.setObject(1, state.id)
                    it.setObject(2, state.roundId)
                    it.executeUpdate()
                }
            connection
                .prepareStatement(
                    """DELETE FROM assets a WHERE a.board_id=? AND a.round_id=? AND a.scope='private'
                AND NOT EXISTS (SELECT 1 FROM elements e WHERE e.board_id=a.board_id AND e.body->>'fileId'=a.id
                AND e.body->>'type'='image' AND e.body->>'isDeleted' IS DISTINCT FROM 'true')"""
                )
                .use {
                    it.setObject(1, state.id)
                    it.setObject(2, state.roundId)
                    it.executeUpdate()
                }
        }
        for (table in listOf("elements", "assets")) {
            // Table names are constants, never supplied by clients.
            val sql =
                if (publish)
                    "UPDATE $table SET scope='public',round_id=NULL WHERE board_id=? AND round_id=? AND scope='private'"
                else "DELETE FROM $table WHERE board_id=? AND round_id=? AND scope='private'"
            connection.prepareStatement(sql).use {
                it.setObject(1, state.id)
                it.setObject(2, state.roundId)
                it.executeUpdate()
            }
        }
        connection
            .prepareStatement(
                "UPDATE rounds SET status=?,revealed_at=CASE WHEN ? THEN now() ELSE NULL END WHERE id=?"
            )
            .use {
                it.setString(1, if (publish) "revealed" else "cancelled")
                it.setBoolean(2, publish)
                it.setObject(3, state.roundId)
                it.executeUpdate()
            }
        connection
            .prepareStatement(
                "UPDATE boards SET mode='standard',current_round_id=NULL,epoch=epoch+1 WHERE id=?"
            )
            .use {
                it.setObject(1, state.id)
                it.executeUpdate()
            }
    }
}
