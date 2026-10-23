package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import java.util.UUID

/** Wire names stay identical to frontend protocol.ts; shared fixtures guard serialization. */
sealed interface ServerEvent

data class SnapshotEvent(val data: SceneSnapshot, val type: String = "snapshot") : ServerEvent
data class PatchEvent(
    val commandId: UUID, val revision: Long, val scope: String,
    val elements: List<JsonNode>, val fileIds: List<String>, val type: String = "patch",
) : ServerEvent
data class RoundEvent(val board: BoardState, val round: RoundState?, val type: String = "round") : ServerEvent
data class MetadataEvent(val name: String, val type: String = "metadata") : ServerEvent
data class PresenceMember(val id: UUID, val name: String, val role: String)
data class PresenceEvent(val participants: List<PresenceMember>, val type: String = "presence") : ServerEvent
data class CursorEvent(val id: UUID, val x: Double, val y: Double, val type: String = "cursor") : ServerEvent
data class PongEvent(val type: String = "pong") : ServerEvent
data class ErrorEvent(val commandId: String?, val code: String, val message: String, val type: String = "error") : ServerEvent
