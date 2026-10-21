package dev.teamcanvas

import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RoundRulesTest {
    private val board = UUID.randomUUID()

    @Test
    fun `commands cannot cross round boundaries even after returning to standard mode`() {
        val page = UUID.randomUUID()
        val old = CommandContext(UUID.randomUUID(), 0, null, page)
        val next = BoardState(board, "Board", "standard", null, 2, 9, page)
        val error =
            assertThrows(ClientException::class.java) { RoundRules.requireContext(next, old) }
        assertEquals("stale_round", error.code)
    }

    @Test
    fun `round IDs must match as well as epochs`() {
        val page = UUID.randomUUID()
        val state = BoardState(board, "Board", "poker", UUID.randomUUID(), 1, 1, page)
        assertThrows(ClientException::class.java) {
            RoundRules.requireContext(
                state,
                CommandContext(UUID.randomUUID(), 1, UUID.randomUUID(), page),
            )
        }
    }
}
