package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.util.UUID

internal sealed interface MutationCommand { val context: CommandContext }
internal data class PatchCommand(override val context: CommandContext, val elements: List<JsonNode>, val files: Map<String, JsonNode>) : MutationCommand
internal data class StartRoundCommand(override val context: CommandContext) : MutationCommand
internal data class ReadyCommand(override val context: CommandContext, val draftRevision: Long) : MutationCommand
internal data class CancelRoundCommand(override val context: CommandContext) : MutationCommand
internal data class CreatePageCommand(override val context: CommandContext, val copyCurrent: Boolean, val includePoker: Boolean) : MutationCommand
internal data class SelectPageCommand(override val context: CommandContext, val targetPageId: UUID) : MutationCommand

/** Decodes untrusted packets before a command reaches application services. */
internal object SocketCommandCodec {
    fun parse(text: String, json: ObjectMapper): JsonNode {
        val packet = try {
            json.readTree(text)
        } catch (_: com.fasterxml.jackson.core.JsonProcessingException) {
            throw ClientException("bad_request", "Invalid JSON message.")
        }
        if (packet == null || !packet.isObject) throw ClientException("bad_request", "Invalid message.")
        return packet
    }

    fun mutation(packet: JsonNode): MutationCommand {
        val context = context(packet)
        return when (packet.path("type").asText()) {
            "patch" -> PatchCommand(context, ElementValidation.validateElements(packet.path("elements")), ElementValidation.validateFiles(packet.get("files")))
            "start_round" -> StartRoundCommand(context)
            "done" -> {
                val revision = packet.path("draftRevision")
                if (!revision.isIntegralNumber || !revision.canConvertToLong())
                    throw ClientException("bad_request", "Draft revision is missing.")
                ReadyCommand(context, revision.asLong())
            }
            "cancel_round" -> CancelRoundCommand(context)
            "create_page" -> CreatePageCommand(context, packet.path("copyCurrent").asBoolean(false), packet.path("includePoker").asBoolean(false))
            "select_page" -> SelectPageCommand(context, UUID.fromString(packet.path("targetPageId").asText()))
            else -> throw ClientException("invalid_message", "Unknown message type.")
        }
    }

    fun context(packet: JsonNode): CommandContext {
        val epoch = packet.path("epoch")
        if (
            !epoch.isIntegralNumber ||
                !epoch.canConvertToLong() ||
                epoch.asLong() < 0 ||
                !packet.has("roundId") || !packet.hasNonNull("pageId")
        )
            throw ClientException("bad_request", "Round context is missing.")
        return CommandContext(
            UUID.fromString(packet.path("commandId").asText()),
            epoch.asLong(),
            packet.get("roundId").takeUnless { it.isNull }?.let { UUID.fromString(it.asText()) },
            UUID.fromString(packet.path("pageId").asText()),
        )
    }

}
