package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.util.UUID

@ApplicationScoped
class AssistantTools @Inject constructor(private val service: AssistantService, private val catalog: CanvasCatalog, private val json: ObjectMapper) {
    val definitions: JsonNode = json.readTree("""[
      {"name":"list_canvases","description":"List canvases the signed-in user can access. Use nextCursor for pagination.","inputSchema":{"type":"object","properties":{"cursor":{"type":"string"}},"additionalProperties":false}},
      {"name":"list_pages","description":"List pages without changing the page followed by collaborators.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"}},"required":["boardId"],"additionalProperties":false}},
      {"name":"inspect_canvas","description":"Read saved objects, exact counts and existing connections. Notes include their bound text or Markdown source and count once. format identifies plain versus markdown notes. Deleted and hidden private objects are excluded.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"},"pageId":{"type":"string"}},"required":["boardId"],"additionalProperties":false}},
      {"name":"count_objects","description":"Answer questions about exact numbers of notes, shapes, text or connections using deterministic counts.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"},"pageId":{"type":"string"}},"required":["boardId"],"additionalProperties":false}},
      {"name":"read_objects","description":"Read the exact text of specific canvas objects. IDs come from inspect_canvas.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"},"pageId":{"type":"string"},"ids":{"type":"array","items":{"type":"string"},"maxItems":50}},"required":["boardId","ids"],"additionalProperties":false}},
      {"name":"get_connected_notes","description":"Read a feature note, its incoming and outgoing labelled connections, and adjacent notes.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"},"pageId":{"type":"string"},"id":{"type":"string"}},"required":["boardId","id"],"additionalProperties":false}},
      {"name":"propose_changes","description":"Save a proposal for review in Team Canvas. Does not immediately change the canvas. Use create_note, create_markdown, create_shape, create_text, connect, update_text, arrange_objects or label_connection. For rearranging existing objects use arrange_objects with ids (up to 12) and layout flow (connected dependencies left to right) or grid. Coordinates and spacing are computed from saved dimensions. For naming an existing bound connection use label_connection with its id and meaningful relationship text; for new connections supply text such as requires, implements or verifies. Use create_markdown for tickets and rich notes; its text is Markdown source (up to 10000 characters). update_text also refines existing Markdown source. Give new objects local IDs so connections can reference them. Coordinates for new content are relative to the insertion point. Existing IDs must come from inspection. Explain suggested relationships in message. Never claim a proposal is applied.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"},"pageId":{"type":"string"},"epoch":{"type":"integer"},"message":{"type":"string","maxLength":4000},"actions":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"object","properties":{"type":{"type":"string","enum":["create_note","create_markdown","create_shape","create_text","connect","update_text","arrange_objects","label_connection"]},"id":{"type":"string"},"ids":{"type":"array","items":{"type":"string"},"maxItems":12},"layout":{"type":"string","enum":["flow","grid"]},"text":{"type":"string","maxLength":10000},"shape":{"type":"string","enum":["rectangle","ellipse","diamond"]},"color":{"type":"string","pattern":"^#[0-9a-fA-F]{6}$"},"sourceId":{"type":"string"},"targetId":{"type":"string"},"x":{"type":"number"},"y":{"type":"number"},"width":{"type":"number"},"height":{"type":"number"}},"required":["type"],"additionalProperties":false}}},"required":["boardId","message","actions"],"additionalProperties":false}},
      {"name":"list_proposals","description":"List your saved proposals and their pending, applied or dismissed status.","inputSchema":{"type":"object","properties":{"boardId":{"type":"string"},"pageId":{"type":"string"}},"required":["boardId"],"additionalProperties":false}}
    ]""").apply {
        val proposal = first { it.path("name").asText() == "propose_changes" }
        (proposal.path("inputSchema").path("properties") as com.fasterxml.jackson.databind.node.ObjectNode)
            .set<JsonNode>("revision", json.readTree("""{"type":"integer","description":"Scene revision from inspect_canvas; rejects refinement if the scene changed before the proposal was saved."}"""))
    }

    fun call(identity: LoginIdentity, name: String, arguments: JsonNode, capability: String? = null): Any {
        if (!arguments.isObject || json.writeValueAsBytes(arguments).size > 70_000) throw ClientException("bad_request", "Invalid tool arguments.")
        if (name == "list_canvases") return catalog.list(identity, "all", "", "recent", 50, arguments.path("cursor").asText().takeIf { it.isNotBlank() })
        fun uuid(field: String): UUID = runCatching { UUID.fromString(arguments.path(field).asText()) }.getOrElse { throw ClientException("bad_request", "Invalid $field.") }
        val boardId = uuid("boardId")
        val pageId = arguments.get("pageId")?.takeUnless { it.isNull }?.let { uuid("pageId") }
        return when (name) {
            "list_proposals" -> service.proposals(identity, boardId, pageId, capability)
            "propose_changes" -> service.propose(identity, boardId, pageId, capability, arguments.path("message").asText("Suggested canvas changes"), arguments.path("actions"), arguments.get("epoch")?.asLong(), arguments.get("revision")?.asLong())
            "list_pages", "inspect_canvas", "count_objects", "read_objects", "get_connected_notes" -> {
                val canvas = service.inspect(identity, boardId, pageId, capability).canvas
                when (name) {
                    "list_pages" -> mapOf("pages" to canvas.pages, "currentPageId" to canvas.board.pageId)
                    "inspect_canvas" -> canvas
                    "count_objects" -> mapOf("message" to AssistantProjection.countAnswer(canvas), "counts" to canvas.counts, "pageId" to canvas.board.pageId)
                    "read_objects" -> {
                        val ids = arguments.path("ids")
                        if (!ids.isArray || ids.size() !in 1..50 || ids.any { !it.isTextual }) throw ClientException("bad_request", "Specify between 1 and 50 object IDs.")
                        val requested = ids.map { it.asText() }.toSet()
                        mapOf("objects" to canvas.objects.filter { it.id in requested }, "missingIds" to requested.minus(canvas.objects.map { it.id }.toSet()))
                    }
                    else -> {
                        val id = arguments.path("id").asText()
                        val selected = canvas.objects.find { it.id == id } ?: throw ClientException("not_found", "Object not found.")
                        val connections = canvas.objects.filter { it.kind == "connection" && (it.sourceId == id || it.targetId == id) }
                        val related = connections.flatMap { listOfNotNull(it.sourceId, it.targetId) }.toSet() - id
                        mapOf("object" to selected, "connections" to connections, "relatedObjects" to canvas.objects.filter { it.id in related })
                    }
                }
            }
            else -> throw ClientException("bad_request", "Unknown canvas tool.")
        }
    }
}
