package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

/** Model chooses the objects and layout; dimensions and spacing come from saved data. */
object AssistantLayout {
    fun expand(raw: JsonNode, canvas: AssistantCanvas, json: ObjectMapper): JsonNode {
        val output = json.createArrayNode()
        for (action in raw) {
            if (action.path("type").asText() != "arrange_objects") { output.add(action); continue }
            val ids = action.path("ids")
            if (!ids.isArray || ids.size() !in 1..12 || ids.any { !it.isTextual } || ids.map { it.asText() }.toSet().size != ids.size()) fail()
            val selected = ids.map { id -> canvas.objects.find { it.id == id.asText() && it.kind in setOf("note", "shape", "text") } ?: fail() }
                .sortedWith(compareBy<CanvasObject> { it.y }.thenBy { it.x }.thenBy { it.id })
            val layout = action.path("layout").asText("flow")
            if (layout !in setOf("flow", "grid")) fail()
            val ranks = mutableMapOf<String, Int>()
            val selectedIds = selected.map { it.id }.toSet()
            val edges = canvas.objects.filter { it.kind == "connection" && it.sourceId in selectedIds && it.targetId in selectedIds }
            // Leave room for labels across columns without letting long labels spread the layout indefinitely.
            val labelGap = (edges.maxOfOrNull { it.text.take(48).length } ?: 0) * 8 + 32
            val columnGap = maxOf(120, labelGap)
            if (layout == "flow") repeat(selected.size) {
                for (node in selected) {
                    val parents = edges.filter { it.targetId == node.id }.mapNotNull { it.sourceId }
                    if (node.id !in ranks && parents.all { it in ranks }) ranks[node.id] = (parents.maxOfOrNull { ranks.getValue(it) } ?: -1) + 1
                }
            }
            // Cycles have no topological ordering, so use a stable grid for the selection.
            val grid = layout == "grid" || ranks.size != selected.size
            if (grid) selected.forEachIndexed { index, node -> ranks[node.id] = index % kotlin.math.ceil(kotlin.math.sqrt(selected.size.toDouble())).toInt() }
            var x = selected.minOf { it.x }
            val top = selected.minOf { it.y }
            for (rank in ranks.values.distinct().sorted()) {
                val column = selected.filter { ranks[it.id] == rank }
                var y = top
                for (node in column) {
                    output.add(json.createObjectNode().put("type", "move_object").put("id", node.id).put("x", x).put("y", y))
                    y += node.height + 72
                }
                x += column.maxOf { it.width } + columnGap
            }
        }
        return output
    }

    private fun fail(): Nothing = throw ClientException("invalid_proposal", "Arrange between 1 and 12 existing notes, shapes or texts using flow or grid layout.")
}
