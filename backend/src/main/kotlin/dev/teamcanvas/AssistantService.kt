package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

data class AssistantScope(val canvas: AssistantCanvas, val ownerKey: String, val elements: List<JsonNode>)

@ApplicationScoped
class AssistantService @Inject constructor(
    private val repository: BoardRepository, private val accounts: Accounts,
    private val scenes: SceneRepository, private val json: ObjectMapper,
) {
    fun inspect(identity: LoginIdentity, boardId: UUID, pageId: UUID? = null, capability: String? = null): AssistantScope =
        authorized(identity, boardId, pageId, capability) { _, scope -> scope }

    private fun <T> authorized(identity: LoginIdentity, boardId: UUID, pageId: UUID?, capability: String?, action: (Connection, AssistantScope) -> T): T {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            val current = repository.board(c, boardId)
            accounts.requireLogin(c, user.id, identity.sid)
            val member = c.query("SELECT id,role FROM participants WHERE board_id=? AND user_id=? AND NOT revoked FOR SHARE", boardId, user.id) {
                if (it.next()) it.getObject(1, UUID::class.java) to it.getString(2) else null
            } ?: throw ClientException("not_found", "Canvas not found or access is unavailable.")
            val pages = repository.pages(c, boardId)
            val page = pageId ?: current.pageId
            if (pages.none { it.id == page }) throw ClientException("not_found", "Page not found.")
            val state = current.copy(pageId = page)
            val draft = capability?.takeIf { state.mode == "poker" && page == current.pageId }
            val who = Participant(member.first, boardId, identity.name, member.second, identity.subject, draftKey = draft)
            val ownerKey = if (draft != null) DraftCapabilities.hash(who, state.roundId)!! else Security.hash("assistant:${user.id}")
            val elements = if (draft != null) scenes.visibleElements(c, who, state).map { it.body }
                else scenes.publicPageElements(c, boardId, page).map { it.body }
            val canvas = AssistantProjection.project(state, pages, if (draft != null) "shared_and_your_draft" else "shared", elements)
            action(c, AssistantScope(canvas, ownerKey, elements))
        }
    }

    fun propose(identity: LoginIdentity, boardId: UUID, pageId: UUID?, capability: String?, message: String, raw: JsonNode, expectedEpoch: Long? = null, expectedRevision: Long? = null): AssistantProposal =
        authorized(identity, boardId, pageId, capability) { c, scope ->
            val board = scope.canvas.board
            if (expectedEpoch != null && board.epoch != expectedEpoch) throw ClientException("stale_round", "The page or poker round changed. Please ask again.")
            if (expectedRevision != null && board.revision != expectedRevision && raw.any { it.path("type").asText() in setOf("connect", "update_text") })
                throw ClientException("stale_proposal", "The canvas changed while the assistant was working. Please ask again.")
            if (board.mode == "poker" && capability == null) throw ClientException("locked", "External proposals are unavailable during poker. Use the canvas chat for your private draft.")
            c.update("DELETE FROM assistant_proposals WHERE board_id=? AND (created_at<now()-interval '1 day' OR epoch<>?)", boardId, board.epoch)
            c.update("DELETE FROM assistant_proposals WHERE board_id=? AND status='dismissed'", boardId)
            c.update("DELETE FROM assistant_proposals WHERE id IN (SELECT id FROM assistant_proposals WHERE board_id=? AND status='applied' ORDER BY created_at DESC OFFSET 50)", boardId)
            val count = c.query("SELECT count(*) FROM assistant_proposals WHERE board_id=? AND status='pending'", boardId) { it.next(); it.getInt(1) }
            if (count >= 200) throw ClientException("limit", "Too many assistant proposals. Dismiss pending proposals before creating more.")
            val id = UUID.randomUUID()
            val actions = AssistantActions.validate(raw, scope.canvas, id, json)
            val referenced = actions.flatMap { listOfNotNull(it.sourceId, it.targetId, it.id.takeIf { _ -> it.type == "update_text" }) }.toSet()
            val objects = scope.canvas.objects.associateBy { it.id }
            val targets = referenced.flatMap { ref -> listOfNotNull(ref, objects[ref]?.textId) }.toSet()
            val originals = scope.elements.filter { it.path("id").asText() in targets }.associateBy { it.path("id").asText() }
            if (originals.values.any { it.path("locked").asBoolean() }) throw ClientException("locked", "A proposal cannot change locked objects.")
            if (board.mode == "poker") {
                val sharedIds = scenes.publicPageElements(c, boardId, board.pageId).map { it.id }.toSet()
                if (originals.keys.any { it in sharedIds }) throw ClientException("locked", "Shared objects are locked during poker. Create and connect your own private notes instead.")
            }
            val proposal = AssistantProposal(id, boardId, board.pageId, board.epoch, board.roundId, message.take(4000), actions)
            c.update("INSERT INTO assistant_proposals(id,board_id,page_id,owner_key,epoch,round_id,body,targets) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb)",
                id, boardId, board.pageId, scope.ownerKey, board.epoch, board.roundId, json.writeValueAsString(proposal), json.writeValueAsString(originals))
            proposal
        }

    fun proposals(identity: LoginIdentity, boardId: UUID, pageId: UUID?, capability: String?): List<AssistantProposal> =
        authorized(identity, boardId, pageId, capability) { c, scope ->
            c.query("SELECT body,status FROM assistant_proposals WHERE board_id=? AND page_id=? AND owner_key=? AND epoch=? AND status<>'dismissed' AND created_at>now()-interval '1 day' ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 250",
                boardId, scope.canvas.board.pageId, scope.ownerKey, scope.canvas.board.epoch) { rows -> buildList {
                while (rows.next()) add(json.readValue(rows.getString(1), AssistantProposal::class.java).copy(status = rows.getString(2)))
            } }
        }

    fun dismiss(identity: LoginIdentity, boardId: UUID, id: UUID, capability: String?) =
        authorized(identity, boardId, null, capability) { c, scope ->
            c.update("UPDATE assistant_proposals SET status='dismissed' WHERE id=? AND board_id=? AND owner_key=? AND status='pending'", id, boardId, scope.ownerKey)
        }
}

/** Called in the existing patch transaction: proposal status and canvas writes commit together. */
object AssistantProposalPersistence {
    fun check(c: Connection, who: Participant, state: BoardState, context: CommandContext, json: ObjectMapper) {
        val row = c.query("SELECT owner_key,epoch,page_id,round_id,targets,status FROM assistant_proposals WHERE id=? AND board_id=? FOR UPDATE", context.commandId, who.boardId) {
            if (!it.next()) null else listOf(it.getString(1), it.getLong(2), it.getObject(3, UUID::class.java), it.getObject(4, UUID::class.java), it.getString(5), it.getString(6))
        } ?: return
        val userId = c.query("SELECT user_id FROM board_sessions WHERE token_hash=?", who.sessionHash) { it.next(); it.getObject(1, UUID::class.java) }
        val owner = if (state.mode == "poker") DraftCapabilities.hash(who, state.roundId) else Security.hash("assistant:$userId")
        if (owner != row[0] || row[5] != "pending") throw ClientException("forbidden", "This proposal is unavailable.")
        if (row[1] != state.epoch || row[2] != state.pageId || row[3] != state.roundId) throw ClientException("stale_round", "The proposal belongs to an earlier page or round.")
        val targets = json.readTree(row[4] as String)
        for ((id, original) in targets.properties()) {
            val current = c.query("SELECT body FROM elements WHERE board_id=? AND page_id=? AND id=?", who.boardId, state.pageId, id) { if (it.next()) json.readTree(it.getString(1)) else null }
            if (current != original) throw ClientException("stale_proposal", "An object changed while the assistant was working. Please regenerate the proposal.")
        }
    }

    fun applied(c: Connection, who: Participant, id: UUID) {
        c.update("UPDATE assistant_proposals SET status='applied' WHERE id=? AND board_id=? AND status='pending'", id, who.boardId)
    }
}
