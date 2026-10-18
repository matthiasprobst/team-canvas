package dev.teamcanvas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SecurityTest {
    @Test
    fun `tokens are unpredictable length and hashes consistent`() {
        val a = Security.token()
        val b = Security.token()
        assertNotEquals(a, b)
        assertTrue(a.length >= 40)
        assertTrue(Security.equalHashes(Security.hash(a), Security.hash(a)))
        assertFalse(Security.equalHashes(Security.hash(a), Security.hash(b)))
    }
}
