package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import java.util.UUID

/** A page copy owns its IDs and never keeps a relationship to the source page. */
internal class PageCopy(
    source: List<JsonNode>,
    newId: () -> String = { UUID.randomUUID().toString().replace("-", "").take(20) },
) {
    private val elementIds = source.associate { it.path("id").asText() to newId() }
    private val groupIds = source.flatMap { it.path("groupIds").map(JsonNode::asText) }
        .distinct().associateWith { newId() }
    val fileIds: Map<String, String> = source
        .filter { it.path("type").asText() == "image" && !it.path("isDeleted").asBoolean() }
        .map { it.path("fileId").asText("") }.filter { it.isNotEmpty() }
        .distinct().associateWith { newId() }

    fun element(original: JsonNode): ObjectNode = original.deepCopy<ObjectNode>().apply {
        put("id", elementIds.getValue(original.path("id").asText()))
        for (field in listOf("containerId", "frameId")) {
            original.get(field)?.takeUnless { it.isNull }?.let {
                put(field, elementIds[it.asText()])
            }
        }
        original.get("groupIds")?.let { groups ->
            putArray("groupIds").also { copy -> groups.forEach { copy.add(groupIds.getValue(it.asText())) } }
        }
        original.get("boundElements")?.takeUnless { it.isNull }?.let { bound ->
            putArray("boundElements").also { copy ->
                bound.forEach { relation ->
                    elementIds[relation.path("id").asText()]?.let { id ->
                        copy.add(relation.deepCopy<ObjectNode>().put("id", id))
                    }
                }
            }
        }
        for (field in listOf("startBinding", "endBinding")) {
            original.get(field)?.takeUnless { it.isNull }?.let { binding ->
                val id = elementIds[binding.path("elementId").asText()]
                if (id == null) putNull(field)
                else set<ObjectNode>(field, binding.deepCopy<ObjectNode>().put("elementId", id))
            }
        }
        if (original.path("type").asText() == "image") {
            fileIds[original.path("fileId").asText()]?.let { put("fileId", it) }
        }
    }
}
