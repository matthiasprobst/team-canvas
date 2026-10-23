package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject

@ApplicationScoped
class RoundService @Inject constructor(private val repository: BoardRepository) {
    fun start(who: Participant, context: CommandContext): CommandResult =
        repository.command(who) command@{ c, state ->
            repository.receipt(c, who, context.commandId)?.let { return@command CommandResult(it, duplicate = true) }
            RoundRules.requireContext(state, context)
            if (state.mode != "standard") throw ClientException("invalid_state", "Poker is already on.")
            val round = java.util.UUID.randomUUID()
            c.update("INSERT INTO rounds(id,board_id) VALUES(?,?)", round, who.boardId)
            c.update("UPDATE boards SET mode='poker',current_round_id=?,epoch=epoch+1 WHERE id=?", round, who.boardId)
            CommandResult(repository.commitCommand(c, who, context.commandId), transitioned = true)
        }

    fun stop(who: Participant, context: CommandContext): CommandResult =
        repository.command(who) command@{ c, state ->
            repository.receipt(c, who, context.commandId)?.let { return@command CommandResult(it, duplicate = true) }
            // Another stop may have committed while this request waited on the canvas lock.
            if (state.mode == "standard" && context.roundId != null && context.epoch + 1 == state.epoch && context.pageId == state.pageId)
                return@command CommandResult(repository.commitCommand(c, who, context.commandId))
            RoundRules.requireContext(state, context)
            if (state.mode != "poker") throw ClientException("invalid_state", "Poker is not on.")
            c.update("DELETE FROM elements WHERE board_id=? AND round_id=? AND scope='private' AND COALESCE((body->>'isDeleted')::boolean,false)", who.boardId, state.roundId)
            c.update("""DELETE FROM assets a WHERE a.board_id=? AND a.round_id=? AND a.scope='private'
                AND NOT EXISTS(SELECT 1 FROM elements e WHERE e.board_id=a.board_id AND e.page_id=a.page_id
                    AND e.body->>'type'='image' AND e.body->>'fileId'=a.id AND NOT COALESCE((e.body->>'isDeleted')::boolean,false))""", who.boardId, state.roundId)
            c.update("UPDATE elements SET scope='public',round_id=NULL,draft_hash=NULL,poker_created=true WHERE board_id=? AND round_id=?", who.boardId, state.roundId)
            c.update("UPDATE assets SET scope='public',round_id=NULL,draft_hash=NULL WHERE board_id=? AND round_id=?", who.boardId, state.roundId)
            c.update("UPDATE boards SET mode='standard',current_round_id=NULL,epoch=epoch+1 WHERE id=?", who.boardId)
            c.update("DELETE FROM rounds WHERE board_id=? AND id=?", who.boardId, state.roundId)
            c.update("DELETE FROM command_receipts WHERE board_id=? AND receipt_scope<>'public'", who.boardId)
            CommandResult(repository.commitCommand(c, who, context.commandId), transitioned = true)
        }
}
