package dev.teamcanvas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ConnectionLimitsTest {
    @Test fun `configured capacity accepts the final slot and rejects overflow`() {
        for (maximum in listOf(1, 10, 30, BoardLimits.CONNECTIONS)) {
            val limits = ConnectionLimits(maximum)
            limits.requireSlot(maximum - 1)
            val error = assertThrows(ClientException::class.java) { limits.requireSlot(maximum) }
            assertEquals("room_full", error.code)
            assertTrue(error.message!!.contains("$maximum active connections"))
            assertThrows(ClientException::class.java) { limits.requireSlot(maximum + 1) }
            // A departure makes the slot available again.
            limits.requireSlot(maximum - 1)
        }
    }

    @Test fun `invalid capacities fail instead of disabling admission control`() {
        for (maximum in listOf(-1, 0, BoardLimits.CONNECTIONS + 1, Int.MAX_VALUE))
            assertThrows(IllegalArgumentException::class.java) { ConnectionLimits(maximum) }
    }
}
