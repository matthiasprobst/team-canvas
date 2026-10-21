package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import java.util.UUID

data class CreateBoardRequest(val name: String = "Untitled canvas")

data class CreatedBoard(val id: UUID, val name: String)

data class JoinRequest(val inviteKey: String? = null)

data class OwnerSummary(val id: UUID, val displayName: String)

data class CanvasSummary(
    val id: UUID,
    val name: String,
    val owner: OwnerSummary,
    val relationship: String,
    val createdAt: String,
    val lastOpenedAt: String?,
    val templateVisibility: String? = null,
    val tags: List<String> = emptyList(),
)

data class TemplateVisibilityRequest(val visibility: String = "private")

data class CanvasTagsRequest(val tags: List<String> = emptyList())

data class CanvasPage(val items: List<CanvasSummary>, val nextCursor: String?)

data class InvitationRequest(val inviteKey: String)

data class JoinedBoard(val id: UUID, val participantId: UUID, val role: String, val token: String)

data class Participant(
    val id: UUID,
    val boardId: UUID,
    val name: String,
    val role: String,
    val subject: String?,
    val sessionHash: String = "",
)

data class BoardState(
    val id: UUID,
    val name: String,
    val mode: String,
    val roundId: UUID?,
    val epoch: Long,
    val revision: Long,
    val pageId: UUID,
)

data class CanvasSheet(val id: UUID, val position: Int)
data class StoredElement(val id: String, val body: JsonNode, val scope: String, val pokerCreated: Boolean)

data class RoundMember(val id: UUID, val name: String, val done: Boolean)

data class RoundState(
    val id: UUID,
    val done: Boolean,
    val included: Boolean,
    val draftRevision: Long,
    val members: List<RoundMember>,
)

data class SceneSnapshot(
    val board: BoardState,
    val round: RoundState?,
    val elements: List<JsonNode>,
    val publicIds: List<String>,
    val fileIds: List<String>,
    val participantId: UUID,
    val role: String,
    val pages: List<CanvasSheet>,
    val pokerCreatedIds: List<String>,
)

data class CommandContext(val commandId: UUID, val epoch: Long, val roundId: UUID?, val pageId: UUID)

data class CommandAck(val type: String = "ack", val commandId: UUID, val revision: Long) : ServerEvent

data class CommandResult(
    val ack: CommandAck,
    val duplicate: Boolean = false,
    val transitioned: Boolean = false,
)

data class PatchResult(val result: CommandResult, val scope: String)

class ClientException(val code: String, override val message: String) : RuntimeException(message)

/** Domain rules are independent of HTTP, sockets, and SQL. */
object RoundRules {
    fun requireContext(state: BoardState, command: CommandContext) {
        if (state.epoch != command.epoch || state.roundId != command.roundId || state.pageId != command.pageId)
            throw ClientException(
                "stale_round",
                "The round changed. Your draft has been preserved.",
            )
    }

    fun allReady(members: List<RoundMember>): Boolean =
        members.isNotEmpty() && members.all { it.done }

    fun requireHost(who: Participant) {
        if (who.role != "host")
            throw ClientException("forbidden", "Only the owner can manage rounds.")
    }
}
