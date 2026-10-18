package dev.teamcanvas

import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RoundRulesTest {
    private val board = UUID.randomUUID()

    @Test
    fun `a round with unfinished or missing participants cannot reveal`() {
        val member = RoundMember(UUID.randomUUID(), "Alice", true)
        assertFalse(RoundRules.allReady(emptyList()))
        assertFalse(
            RoundRules.allReady(listOf(member, member.copy(id = UUID.randomUUID(), done = false)))
        )
        assertTrue(RoundRules.allReady(listOf(member)))
    }

    @Test
    fun `commands cannot cross round boundaries even after returning to standard mode`() {
        val old = CommandContext(UUID.randomUUID(), 0, null)
        val next = BoardState(board, "Board", "standard", null, 2, 9)
        val error =
            assertThrows(ClientException::class.java) { RoundRules.requireContext(next, old) }
        assertEquals("stale_round", error.code)
    }

    @Test
    fun `round IDs must match as well as epochs`() {
        val state = BoardState(board, "Board", "poker", UUID.randomUUID(), 1, 1)
        assertThrows(ClientException::class.java) {
            RoundRules.requireContext(
                state,
                CommandContext(UUID.randomUUID(), 1, UUID.randomUUID()),
            )
        }
    }
}
