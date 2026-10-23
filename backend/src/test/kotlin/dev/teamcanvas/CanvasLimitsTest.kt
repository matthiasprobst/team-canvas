package dev.teamcanvas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class CanvasLimitsTest {
    @Test fun `limits must be positive and boundaries reject growth`() {
        assertThrows(IllegalArgumentException::class.java) { CanvasLimits(0, 20) }
        assertThrows(IllegalArgumentException::class.java) { CanvasLimits(10, -1) }
        CanvasLimits().requirePageSlot(9)
        assertThrows(ClientException::class.java) { CanvasLimits().requirePageSlot(10) }
    }
}
