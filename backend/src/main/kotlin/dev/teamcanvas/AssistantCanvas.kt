package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.util.UUID

data class CanvasObject(
    val id: String, val kind: String, val text: String,
    val x: Double, val y: Double, val width: Double, val height: Double,
    val textId: String? = null, val sourceId: String? = null, val targetId: String? = null,
    val format: String = "plain",
)
data class CanvasFacts(val objects: Int, val notes: Int, val shapes: Int, val texts: Int, val connections: Int, val other: Int, val rawElements: Int)
data class AssistantCanvas(val board: BoardState, val pages: List<CanvasSheet>, val scope: String, val counts: CanvasFacts, val objects: List<CanvasObject>)
data class CanvasAction(
    val type: String, val id: String = "", val text: String = "", val shape: String = "rectangle",
    val color: String = "#fff3bf", val sourceId: String? = null, val targetId: String? = null,
    val x: Double = 0.0, val y: Double = 0.0, val width: Double = 220.0, val height: Double = 170.0,
)
data class AssistantProposal(
    val id: UUID, val boardId: UUID, val pageId: UUID, val epoch: Long, val roundId: UUID?,
    val message: String, val actions: List<CanvasAction>, val status: String = "pending",
)
data class AssistantReply(val message: String, val referenceIds: List<String> = emptyList(), val proposal: AssistantProposal? = null, val canvas: AssistantCanvas? = null)

/** Logical notes combine their container and bound text; counts never depend on model arithmetic. */
object AssistantProjection {
    fun project(state: BoardState, pages: List<CanvasSheet>, scope: String, elements: List<JsonNode>): AssistantCanvas {
        val live = elements.filter { !it.path("isDeleted").asBoolean() }
        val ids = live.map { it.path("id").asText() }.toSet()
        val labels = live.filter { it.path("type").asText() == "text" && it.path("containerId").asText() in ids }
            .associateBy { it.path("containerId").asText() }
        val objects = live.filter { it !in labels.values }.map { element ->
            val id = element.path("id").asText()
            val type = element.path("type").asText()
            val label = labels[id]
            val markdown = type == "embeddable" && element.path("customData").path("teamCanvasKind").asText() == "markdown"
            val note = markdown || element.path("customData").path("teamCanvasKind").asText() == "note" ||
                (type == "rectangle" && label != null && element.path("backgroundColor").asText() == "#fff3bf" && element.path("strokeColor").asText() == "#b08900")
            val kind = when {
                note -> "note"
                type in setOf("rectangle", "ellipse", "diamond") -> "shape"
                type in setOf("arrow", "line") -> "connection"
                type == "text" -> "text"
                else -> "other"
            }
            CanvasObject(id, kind, if (markdown) element.path("customData").path("markdown").asText() else (label ?: element).path("text").asText(""),
                element.path("x").asDouble(), element.path("y").asDouble(), element.path("width").asDouble(), element.path("height").asDouble(),
                label?.path("id")?.asText(),
                element.path("startBinding").path("elementId").asText().takeIf { it in ids },
                element.path("endBinding").path("elementId").asText().takeIf { it in ids }, if (markdown) "markdown" else "plain")
        }
        fun count(kind: String) = objects.count { it.kind == kind }
        return AssistantCanvas(state, pages, scope, CanvasFacts(objects.size, count("note"), count("shape"), count("text"), count("connection"), count("other"), live.size), objects)
    }

    fun countAnswer(canvas: AssistantCanvas): String = with(canvas.counts) {
        "${if (canvas.scope == "selection") "This selection" else "This page"} contains $objects objects: $notes notes, $shapes shapes, $texts standalone texts, $connections connections, and $other other objects ($rawElements drawing elements including bound labels)."
    }
}

object AssistantActions {
    private val colors = Regex("^#[0-9a-fA-F]{6}$")
    private val safeId = Regex("^[A-Za-z0-9_-]{1,128}$")

    fun validate(raw: JsonNode, canvas: AssistantCanvas, proposalId: UUID, json: ObjectMapper): List<CanvasAction> {
        if (!raw.isArray || raw.size() !in 1..20) fail()
        if (raw.any { it.path("type").asText() == "arrange_objects" }) return validate(AssistantLayout.expand(raw, canvas, json), canvas, proposalId, json)
        val objects = canvas.objects.associateBy { it.id }
        val local = mutableSetOf<String>()
        val spacious = raw.any { it.path("type").asText() == "create_markdown" }
        val actions = raw.mapIndexed { index, item ->
            if (!item.isObject) fail()
            val type = item.path("type").asText()
            if (type !in setOf("create_note", "create_markdown", "create_shape", "create_text", "connect", "update_text", "move_object", "label_connection")) fail()
            val text = item.path("text").asText("")
            val markdown = type == "create_markdown" || (type == "update_text" && objects[item.path("id").asText()]?.format == "markdown")
            if (text.length > (if (markdown) 10_000 else 2000) || (type in setOf("create_note", "create_markdown", "create_text", "update_text") && text.isBlank())) fail()
            val id = if (type in setOf("update_text", "move_object", "label_connection")) item.path("id").asText() else "ai_${proposalId.toString().replace("-", "")}_$index"
            if (type == "move_object" && (objects[id]?.kind !in setOf("note", "shape", "text") || !item.has("x") || !item.has("y"))) fail()
            if (type == "label_connection" && (objects[id]?.kind != "connection" || text.isBlank() || text.length > 200 || canvas.objects.none { it.id == id && it.sourceId != null && it.targetId != null })) fail()
            val ref = item.path("id").asText()
            if (type.startsWith("create_") && ref.isNotBlank()) {
                if (!safeId.matches(ref) || !local.add(ref) || objects.containsKey(ref)) fail()
            }
            val shape = item.path("shape").asText("rectangle")
            val color = item.path("color").asText("#fff3bf")
            if (shape !in setOf("rectangle", "ellipse", "diamond") || !colors.matches(color)) fail()
            fun number(name: String, default: Double, min: Double, max: Double): Double {
                val node = item.get(name) ?: return default
                if (!node.isNumber || !node.asDouble().isFinite() || node.asDouble() !in min..max) fail()
                return node.asDouble()
            }
            CanvasAction(type, id, text, shape, color,
                item.path("sourceId").asText().takeIf { it.isNotBlank() }, item.path("targetId").asText().takeIf { it.isNotBlank() },
                number("x", (index % 3) * (if (spacious) 460.0 else 260.0), -100_000.0, 100_000.0), number("y", (index / 3) * (if (spacious) 400.0 else 210.0), -100_000.0, 100_000.0),
                number("width", if (markdown) 420.0 else 220.0, 40.0, 1200.0), number("height", if (markdown) 360.0 else 170.0, 40.0, 1200.0))
        }
        val remap = raw.mapIndexedNotNull { index, item ->
            item.path("id").asText().takeIf { actions[index].type.startsWith("create_") && it.isNotBlank() }?.let { it to actions[index].id }
        }.toMap()
        val created = actions.filter { it.type.startsWith("create_") }.associateBy { it.id }
        fun target(id: String?): String {
            val resolved = remap[id] ?: id ?: fail()
            if (!safeId.matches(resolved) || (resolved !in objects && resolved !in created)) fail()
            return resolved
        }
        return actions.map { action ->
            when (action.type) {
                "connect" -> {
                    val source = target(action.sourceId)
                    val destination = target(action.targetId)
                    if (source == destination || listOf(source, destination).any { objects[it]?.kind in setOf("connection", "other") }) fail()
                    action.copy(sourceId = source, targetId = destination)
                }
                "update_text" -> {
                    if (objects[action.id]?.let { it.kind == "text" || it.textId != null || it.format == "markdown" } != true) fail()
                    action
                }
                else -> action
            }
        }.also { if (json.writeValueAsBytes(it).size > 64_000) fail() }
    }

    private fun fail(): Nothing = throw ClientException("invalid_proposal", "The assistant returned an invalid canvas proposal. Please try again.")
}
