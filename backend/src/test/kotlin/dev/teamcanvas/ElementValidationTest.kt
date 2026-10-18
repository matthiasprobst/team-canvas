package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ElementValidationTest {
    private val json = jacksonObjectMapper()

    @Test
    fun `scripts and embeddables are rejected`() {
        val invalid =
            json.readTree(
                """[{"id":"evil","type":"embeddable","x":0,"y":0,"width":10,"height":10}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(invalid) }
    }

    @Test
    fun `external links and untrusted custom metadata removed`() {
        val input =
            json.readTree(
                """[{"id":"safe","type":"rectangle","x":0,"y":0,"width":10,"height":10,"link":"javascript:alert(1)","customData":{"bad":true}}]"""
            )
        val element = ElementValidation.validateElements(input).single()
        assertFalse(element.has("link"))
        assertFalse(element.has("customData"))
    }

    @Test
    fun `SVG data URLs are rejected`() {
        val images =
            json.readTree(
                """{"img":{"id":"img","mimeType":"image/svg+xml","dataURL":"data:image/svg+xml;base64,PHN2Zz4=","created":1}}"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateFiles(images) }
    }

    @Test
    fun `duplicate IDs and malformed geometry are rejected`() {
        val duplicate =
            json.readTree(
                """[{"id":"a","type":"rectangle","x":0,"y":0,"width":10,"height":10},{"id":"a","type":"rectangle","x":0,"y":0,"width":10,"height":10}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(duplicate) }
        val negative =
            json.readTree("""[{"id":"a","type":"rectangle","x":0,"y":0,"width":-1,"height":10}]""")
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(negative) }
    }

    @Test
    fun `nested points and text types are validated`() {
        val points =
            json.readTree(
                """[{"id":"a","type":"freedraw","x":0,"y":0,"width":10,"height":10,"points":[[0,"invalid"]]}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(points) }
        val text =
            json.readTree(
                """[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":{}}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(text) }
    }

    @Test
    fun `image signatures must match the declared MIME type`() {
        val images =
            json.readTree(
                """{"img":{"id":"img","mimeType":"image/png","dataURL":"data:image/png;base64,YWJjZA==","created":1}}"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateFiles(images) }
    }

    @Test
    fun `minimal shapes receive safe editor defaults`() {
        val input =
            json.readTree(
                """[{"id":"safe","type":"rectangle","x":0,"y":0,"width":10,"height":10}]"""
            )
        val element = ElementValidation.validateElements(input).single()
        assertTrue(element.path("groupIds").isArray)
        assertEquals(100, element.path("opacity").asInt())
        assertFalse(element.path("isDeleted").asBoolean())
    }

    @Test
    fun `unsupported fonts and malformed fixed segments are rejected`() {
        val text =
            json.readTree(
                """[{"id":"a","type":"text","text":"Hello","fontFamily":999,"x":0,"y":0,"width":10,"height":10}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(text) }
        val arrow =
            json.readTree(
                """[{"id":"a","type":"arrow","x":0,"y":0,"width":10,"height":10,"points":[[0,0],[10,10]],"fixedSegments":[{"index":99,"start":[0,0],"end":[1,1]}]}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(arrow) }
    }

    @Test
    fun `nullable elbow arrow flags from Excalidraw are supported`() {
        val input =
            json.readTree(
                """[{"id":"a","type":"arrow","x":0,"y":0,"width":10,"height":10,"points":[[0,0],[10,10]],"startIsSpecial":null,"endIsSpecial":null,"elbowed":true}]"""
            )
        assertEquals(
            "arrow",
            ElementValidation.validateElements(input).single().path("type").asText(),
        )
    }

    @Test
    fun `invalid fractional indices cannot poison layer reconciliation`() {
        val input =
            json.readTree(
                """[{"id":"a","type":"rectangle","x":0,"y":0,"width":10,"height":10,"index":"A"}]"""
            )
        assertThrows(ClientException::class.java) { ElementValidation.validateElements(input) }
        (input[0] as com.fasterxml.jackson.databind.node.ObjectNode).put("index", "a0")
        assertEquals(
            "a0",
            ElementValidation.validateElements(input).single().path("index").asText(),
        )
    }
}
