package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import java.util.Base64

/** Validate the drawing schema before untrusted data reaches persistence or another browser. */
object ElementValidation {
    private val allowedTypes =
        setOf("rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "text", "image")
    private val safeId = Regex("^[A-Za-z0-9_-]{1,128}$")
    private val fields =
        setOf(
            "id",
            "type",
            "x",
            "y",
            "width",
            "height",
            "angle",
            "strokeColor",
            "backgroundColor",
            "fillStyle",
            "strokeWidth",
            "strokeStyle",
            "roughness",
            "opacity",
            "groupIds",
            "frameId",
            "index",
            "roundness",
            "seed",
            "version",
            "versionNonce",
            "isDeleted",
            "boundElements",
            "updated",
            "locked",
            "text",
            "originalText",
            "fontSize",
            "fontFamily",
            "textAlign",
            "verticalAlign",
            "containerId",
            "autoResize",
            "lineHeight",
            "points",
            "lastCommittedPoint",
            "startBinding",
            "endBinding",
            "startArrowhead",
            "endArrowhead",
            "elbowed",
            "fixedSegments",
            "startIsSpecial",
            "endIsSpecial",
            "pressures",
            "simulatePressure",
            "fileId",
            "status",
            "scale",
            "crop",
        )
    private val numeric =
        setOf(
            "angle",
            "strokeWidth",
            "roughness",
            "opacity",
            "seed",
            "version",
            "versionNonce",
            "updated",
            "fontSize",
            "fontFamily",
            "lineHeight",
        )
    private val booleans =
        setOf(
            "isDeleted",
            "locked",
            "autoResize",
            "elbowed",
            "startIsSpecial",
            "endIsSpecial",
            "simulatePressure",
        )
    private val strings =
        setOf(
            "strokeColor",
            "backgroundColor",
            "fillStyle",
            "strokeStyle",
            "textAlign",
            "verticalAlign",
            "status",
        )

    fun validateElements(items: JsonNode): List<JsonNode> {
        if (!items.isArray || items.size() > BoardLimits.PATCH_ELEMENTS)
            fail("invalid_patch", "A change can contain at most 100 elements.")
        val ids = mutableSetOf<String>()
        return items.map { raw ->
            if (!raw.isObject || raw.toString().toByteArray(Charsets.UTF_8).size > 100_000)
                invalid()
            val id = raw.path("id")
            if (!id.isTextual || !safeId.matches(id.asText()) || !ids.add(id.asText())) invalid()
            if (!raw.path("type").isTextual || raw.path("type").asText() !in allowedTypes) invalid()
            if (raw.path("type").asText() == "text" && !raw.path("text").isTextual) invalid()
            if (
                raw.path("type").asText() == "image" &&
                    !raw.path("isDeleted").asBoolean() &&
                    !safeId.matches(raw.path("fileId").asText())
            )
                invalid()
            validateScalarFields(raw)
            validateShapeGeometry(raw)
            validateObjectReferences(raw)
            validatePointArrays(raw)
            validateBindings(raw)
            validateDecorations(raw)
            // Nested optional drawing metadata must contain bounded scalar/array/object values.
            validateNested(raw, 0)
            (raw.deepCopy<JsonNode>() as ObjectNode).apply {
                remove(raw.fieldNames().asSequence().filter { it !in fields }.toList())
                defaults(this)
            }
        }
    }

    private fun validateScalarFields(raw: JsonNode) {
        for (field in listOf("x", "y", "width", "height")) finite(raw.path(field), 1_000_000.0)
        if (raw.path("width").asDouble() < 0 || raw.path("height").asDouble() < 0) invalid()
        for (field in numeric) raw.get(field)?.let { finite(it, 1e16) }
        for (field in booleans) raw.get(field)?.let {
            if (
                !it.isBoolean &&
                    !(it.isNull && field in setOf("startIsSpecial", "endIsSpecial"))
            )
                invalid()
    }
    for (field in strings) raw.get(field)?.let {
        if (!it.isTextual || it.asText().length > 128) invalid()
    }
    for (field in listOf("text", "originalText")) raw.get(field)?.let {
        if (!it.isTextual || it.asText().length > 10_000) invalid()
    }
    val enums =
        mapOf(
            "fillStyle" to setOf("hachure", "cross-hatch", "solid", "zigzag"),
            "strokeStyle" to setOf("solid", "dashed", "dotted"),
            "textAlign" to setOf("left", "center", "right"),
            "verticalAlign" to setOf("top", "middle", "bottom"),
            "status" to setOf("pending", "saved", "error"),
        )
    for ((field, values) in enums) raw.get(field)?.let {
        if (it.asText() !in values) invalid()
    }
    raw.get("fontFamily")?.let {
        if (!it.isIntegralNumber || it.asInt() !in setOf(1, 2, 3, 5, 6, 7, 8, 9)) invalid()
    }
    raw.get("fontSize")?.let { if (it.asDouble() !in 1.0..1000.0) invalid() }
    raw.get("lineHeight")?.let { if (it.asDouble() !in 0.1..10.0) invalid() }
    for ((field, bound) in
        mapOf("opacity" to 100.0, "strokeWidth" to 100.0, "roughness" to 10.0)) raw.get(
            field
        )
        ?.let { if (it.asDouble() !in 0.0..bound) invalid() }
    if (
        raw.path("type").asText() in setOf("line", "arrow", "freedraw") &&
            (!raw.path("points").isArray || raw.path("points").isEmpty)
    )
        invalid()
    }

    private fun validateShapeGeometry(raw: JsonNode) {
        raw.get("lastCommittedPoint")
            ?.takeUnless { it.isNull }
            ?.let {
                if (!it.isArray || it.size() != 2) invalid()
                it.forEach { number -> finite(number, 1_000_000.0) }
            }
        raw.get("crop")
            ?.takeUnless { it.isNull }
            ?.let { crop ->
                if (!crop.isObject) invalid()
                for (field in
                    listOf(
                        "x",
                        "y",
                        "width",
                        "height",
                        "naturalWidth",
                        "naturalHeight",
                    )) finite(crop.path(field), 1_000_000.0)
                for (field in listOf("width", "height", "naturalWidth", "naturalHeight")) if (
                    crop.path(field).asDouble() <= 0
                )
                    invalid()
            }
        raw.get("fixedSegments")
            ?.takeUnless { it.isNull }
            ?.let { segments ->
                if (!segments.isArray || segments.size() > 100) invalid()
                segments.forEach { segment ->
                    if (
                        !segment.isObject ||
                            !segment.path("index").isIntegralNumber ||
                            segment.path("index").asInt() !in 0 until raw.path("points").size()
                    )
                        invalid()
                    for (field in listOf("start", "end")) {
                        val point = segment.path(field)
                        if (!point.isArray || point.size() != 2) invalid()
                        point.forEach { number -> finite(number, 1_000_000.0) }
                    }
                }
            }
    }

    private fun validateObjectReferences(raw: JsonNode) {
        for (field in listOf("fileId", "frameId", "containerId")) raw.get(field)
            ?.takeUnless { it.isNull }
            ?.let { if (!it.isTextual || !safeId.matches(it.asText())) invalid() }
        raw.get("index")
            ?.takeUnless { it.isNull }
            ?.let { if (!it.isTextual || !validIndex(it.asText())) invalid() }
        raw.get("groupIds")?.let { list ->
            if (
                !list.isArray ||
                    list.size() > 100 ||
                    list.any { !it.isTextual || !safeId.matches(it.asText()) }
            )
                invalid()
    }
    }

    private fun validatePointArrays(raw: JsonNode) {
        for (field in listOf("points", "scale")) raw.get(field)?.let { value ->
            if (!value.isArray || value.size() > 4000) invalid()
            if (field == "scale") {
                if (value.size() != 2) invalid()
                value.forEach {
                    finite(it, 1.0)
                    if (kotlin.math.abs(it.asDouble()) != 1.0) invalid()
                }
            } else
                value.forEach { point ->
                    if (!point.isArray || point.size() != 2) invalid()
                    point.forEach { finite(it, 1_000_000.0) }
                }
    }
    raw.get("pressures")?.let { values ->
        if (!values.isArray || values.size() > 4000) invalid()
        values.forEach { finite(it, 1.0) }
    }
    }

    private fun validateBindings(raw: JsonNode) {
        raw.get("boundElements")
            ?.takeUnless { it.isNull }
            ?.let { values ->
                if (!values.isArray || values.size() > 100) invalid()
                values.forEach {
                    if (
                        !it.isObject ||
                            !it.path("id").isTextual ||
                            !safeId.matches(it.path("id").asText()) ||
                            it.path("type").asText() !in setOf("arrow", "text")
                    )
                        invalid()
                }
            }
        for (field in listOf("startBinding", "endBinding")) raw.get(field)
            ?.takeUnless { it.isNull }
            ?.let { binding ->
                if (
                    !binding.isObject ||
                        !binding.path("elementId").isTextual ||
                        !safeId.matches(binding.path("elementId").asText())
                )
                    invalid()
                binding.get("focus")?.let { finite(it, 1.0) }
                binding.get("gap")?.let { finite(it, 1_000_000.0) }
                binding
                    .get("fixedPoint")
                    ?.takeUnless { it.isNull }
                    ?.let {
                        if (!it.isArray || it.size() != 2) invalid()
                        it.forEach { number -> finite(number, 1_000_000.0) }
                    }
            }
    }

    private fun validateDecorations(raw: JsonNode) {
        raw.get("roundness")
            ?.takeUnless { it.isNull }
            ?.let {
                if (!it.isObject) invalid()
                finite(it.path("type"), 10.0)
                it.get("value")?.let { value -> finite(value, 1_000_000.0) }
            }
        for (field in listOf("startArrowhead", "endArrowhead")) raw.get(field)
            ?.takeUnless { it.isNull }
            ?.let {
                if (
                    !it.isTextual ||
                        it.asText() !in
                            setOf(
                                "arrow",
                                "bar",
                                "dot",
                                "circle",
                                "circle_outline",
                                "triangle",
                                "triangle_outline",
                                "diamond",
                                "diamond_outline",
                                "crowfoot_one",
                                "crowfoot_many",
                                "crowfoot_one_or_many",
                            )
                )
                    invalid()
            }
    }


    /** Complete optional legacy fields so a minimal valid patch cannot poison the editor. */
    private fun defaults(element: ObjectNode) {
        val nodes = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance
        for ((field, value) in
            mapOf(
                "angle" to 0,
                "strokeWidth" to 1,
                "roughness" to 1,
                "opacity" to 100,
                "seed" to 1,
                "version" to 1,
                "versionNonce" to 0,
                "updated" to 0,
            )) element.putIfAbsent(field, nodes.numberNode(value))
        for ((field, value) in
            mapOf(
                "strokeColor" to "#1e1e1e",
                "backgroundColor" to "transparent",
                "fillStyle" to "hachure",
                "strokeStyle" to "solid",
            )) element.putIfAbsent(field, nodes.textNode(value))
        for (field in listOf("index", "frameId", "roundness", "boundElements")) element.putIfAbsent(
            field,
            nodes.nullNode(),
        )
        for (field in listOf("isDeleted", "locked")) element.putIfAbsent(
            field,
            nodes.booleanNode(false),
        )
        element.putIfAbsent("groupIds", nodes.arrayNode())
        when (element.path("type").asText()) {
            "text" -> {
                element.putIfAbsent("fontSize", nodes.numberNode(20))
                element.putIfAbsent("fontFamily", nodes.numberNode(5))
                element.putIfAbsent("lineHeight", nodes.numberNode(1.25))
                element.putIfAbsent("originalText", element.get("text"))
                element.putIfAbsent("textAlign", nodes.textNode("left"))
                element.putIfAbsent("verticalAlign", nodes.textNode("top"))
                element.putIfAbsent("containerId", nodes.nullNode())
                element.putIfAbsent("autoResize", nodes.booleanNode(true))
            }
            "image" -> {
                element.put("status", "saved")
                element.putIfAbsent("scale", nodes.arrayNode().add(1).add(1))
                element.putIfAbsent("crop", nodes.nullNode())
            }
            "line",
            "arrow",
            "freedraw" -> {
                element.putIfAbsent("lastCommittedPoint", nodes.nullNode())
                if (element.path("type").asText() == "freedraw") {
                    element.putIfAbsent("pressures", nodes.arrayNode())
                    element.putIfAbsent("simulatePressure", nodes.booleanNode(true))
                } else {
                    for (field in
                        listOf(
                            "startBinding",
                            "endBinding",
                            "startArrowhead",
                            "endArrowhead",
                        )) element.putIfAbsent(field, nodes.nullNode())
                    element.putIfAbsent("elbowed", nodes.booleanNode(false))
                }
            }
        }
    }

    private fun validateNested(node: JsonNode, depth: Int) {
        if (depth > 8) invalid()
        if (node.isNumber) finite(node, 1e16)
        if (node.isArray || node.isObject) {
            if (node.size() > 4000) invalid()
            node.forEach { validateNested(it, depth + 1) }
        }
    }

    fun validateFiles(files: JsonNode?): Map<String, JsonNode> {
        if (files == null || files.isNull) return emptyMap()
        if (!files.isObject || files.size() > 1)
            fail("invalid_file", "Only one image is allowed per change.")
        return files.properties().asSequence().associate { (id, value) ->
            if (
                !safeId.matches(id) ||
                    !value.isObject ||
                    !value.path("id").isTextual ||
                    value.path("id").asText() != id
            )
                invalidFile()
            val url = value.path("dataURL").asText("")
            val mime = value.path("mimeType").asText("")
            if (
                mime !in setOf("image/png", "image/jpeg", "image/webp", "image/gif") ||
                    url.length > 1_400_000 ||
                    !url.startsWith("data:$mime;base64,")
            )
                invalidFile()
            val bytes =
                try {
                    Base64.getDecoder().decode(url.substringAfter(','))
                } catch (_: IllegalArgumentException) {
                    invalidFile()
                }
            if (bytes.size > 1_048_576 || !imageSignature(bytes, mime)) invalidFile()
            ImageValidation.requireSafeDimensions(bytes, mime)
            val sanitized = value.deepCopy<JsonNode>() as ObjectNode
            sanitized.remove(
                value
                    .fieldNames()
                    .asSequence()
                    .filter {
                        it !in setOf("id", "dataURL", "mimeType", "created", "lastRetrieved")
                    }
                    .toList()
            )
            for (field in listOf("created", "lastRetrieved")) sanitized.get(field)?.let {
                finite(it, 1e16)
            }
            id to sanitized
        }
    }

    private fun imageSignature(bytes: ByteArray, mime: String): Boolean {
        fun starts(vararg signature: Int) =
            bytes.size >= signature.size &&
                signature.indices.all { (bytes[it].toInt() and 255) == signature[it] }
        return when (mime) {
            "image/png" -> starts(137, 80, 78, 71, 13, 10, 26, 10)
            "image/jpeg" -> starts(255, 216, 255)
            "image/gif" ->
                bytes.size >= 6 &&
                    String(bytes.copyOfRange(0, 6), Charsets.US_ASCII) in setOf("GIF87a", "GIF89a")
            "image/webp" ->
                bytes.size >= 12 &&
                    String(bytes.copyOfRange(0, 4), Charsets.US_ASCII) == "RIFF" &&
                    String(bytes.copyOfRange(8, 12), Charsets.US_ASCII) == "WEBP"
            else -> false
        }
    }

    private fun finite(node: JsonNode, bound: Double) {
        if (
            !node.isNumber ||
                !node.asDouble().isFinite() ||
                kotlin.math.abs(node.asDouble()) > bound
        )
            invalid()
    }

    private fun validIndex(value: String): Boolean {
        if (!Regex("^[A-Za-z][A-Za-z0-9]{1,127}$").matches(value)) return false
        val head = value[0]
        val integerLength = if (head in 'a'..'z') head - 'a' + 2 else 'Z' - head + 2
        return value.length >= integerLength &&
            value != "A" + "0".repeat(26) &&
            (value.length == integerLength || value.last() != '0')
    }

    private fun invalid(): Nothing = fail("invalid_element", "Invalid element data.")

    private fun invalidFile(): Nothing =
        fail("invalid_file", "Invalid image or image larger than 1 MB.")

    private fun fail(code: String, message: String): Nothing = throw ClientException(code, message)
}
