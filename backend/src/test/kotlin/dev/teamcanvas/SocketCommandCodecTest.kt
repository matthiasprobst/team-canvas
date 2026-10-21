package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SocketCommandCodecTest {
    private val json = jacksonObjectMapper()
    private val context = """"commandId":"00000000-0000-4000-8000-000000000001","epoch":1,"roundId":null,"pageId":"00000000-0000-4000-8000-000000000003""""
    private fun packet(fields: String) = SocketCommandCodec.parse("{$context,$fields}", json)

    @Test
    fun `malformed JSON invalid contexts and incomplete readiness are rejected before dispatch`() {
        for (raw in listOf("null", "[]", "{", "42")) {
            assertEquals("bad_request", assertThrows(ClientException::class.java) { SocketCommandCodec.parse(raw, json) }.code)
        }
        val missingPage = json.readTree("""{"type":"start_round","commandId":"00000000-0000-4000-8000-000000000001","epoch":0,"roundId":null}""")
        assertThrows(ClientException::class.java) { SocketCommandCodec.mutation(missingPage) }
        assertThrows(ClientException::class.java) { SocketCommandCodec.mutation(packet(""""type":"done"""")) }
        assertThrows(ClientException::class.java) { SocketCommandCodec.mutation(packet(""""type":"done","draftRevision":1.5""")) }
    }

    @Test
    fun `page options retain their existing defaults and controls decode with context`() {
        val page = SocketCommandCodec.mutation(packet(""""type":"create_page"""")) as CreatePageCommand
        assertFalse(page.copyCurrent)
        assertFalse(page.includePoker)
        assertEquals(1, page.context.epoch)
        assertTrue(SocketCommandCodec.mutation(packet(""""type":"start_round"""")) is StartRoundCommand)
        assertTrue(SocketCommandCodec.mutation(packet(""""type":"cancel_round"""")) is CancelRoundCommand)
        assertEquals(4, (SocketCommandCodec.mutation(packet(""""type":"done","draftRevision":4""")) as ReadyCommand).draftRevision)
    }
}
