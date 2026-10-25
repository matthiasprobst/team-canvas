package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PageCopyTest {
    private val json = jacksonObjectMapper()

    @Test
    fun `copy remaps containers arrows groups and shared images without mutating originals`() {
        val source = json.readTree("""[
          {"id":"box","type":"rectangle","groupIds":["group"],"boundElements":[{"id":"text","type":"text"},{"id":"arrow","type":"arrow"},{"id":"excluded","type":"arrow"}]},
          {"id":"text","type":"text","containerId":"box","groupIds":["group"]},
          {"id":"arrow","type":"arrow","startBinding":{"elementId":"box","focus":0,"gap":1},"endBinding":{"elementId":"excluded"},"frameId":"excluded"},
          {"id":"image-a","type":"image","fileId":"file"},
          {"id":"image-b","type":"image","fileId":"file"}
        ]""").toList()
        val before = source.map { it.deepCopy<com.fasterxml.jackson.databind.JsonNode>() }
        var sequence = 0
        val mapping = PageCopy(source) { "copy-${++sequence}" }
        val copied = source.map(mapping::element)
        val boxId = copied[0].path("id").asText()
        assertNotEquals("box", boxId)
        assertEquals(boxId, copied[1].path("containerId").asText())
        assertEquals(boxId, copied[2].path("startBinding").path("elementId").asText())
        assertEquals(copied[1].path("id"), copied[0].path("boundElements")[0].path("id"))
        assertEquals(2, copied[0].path("boundElements").size())
        assertTrue(copied[2].path("endBinding").isNull)
        assertTrue(copied[2].path("frameId").isNull)
        assertEquals(copied[0].path("groupIds"), copied[1].path("groupIds"))
        assertNotEquals("group", copied[0].path("groupIds")[0].asText())
        assertEquals(copied[3].path("fileId"), copied[4].path("fileId"))
        assertNotEquals("file", copied[3].path("fileId").asText())
        assertEquals(before, source)
    }

    @Test
    fun `copy preserves null optional fields and does not allocate files for deleted images`() {
        val source = json.readTree("""{"id":"deleted","type":"image","fileId":"gone","isDeleted":true,"containerId":null,"boundElements":null}""")
        val mapping = PageCopy(listOf(source))
        assertTrue(mapping.fileIds.isEmpty())
        val copied = mapping.element(source)
        assertTrue(copied.path("containerId").isNull)
        assertTrue(copied.path("boundElements").isNull)
        assertTrue(copied.path("isDeleted").asBoolean())
    }
}
