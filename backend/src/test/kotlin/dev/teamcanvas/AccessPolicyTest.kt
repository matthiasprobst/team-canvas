package dev.teamcanvas

import java.security.Principal
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class AccessPolicyTest {
    @Test
    fun `production requires an authenticated identity and an exact trusted origin`() {
        val policy = AccessPolicy().apply { origins = "https://team-canvas.example.internal" }
        assertThrows(ClientException::class.java) { loginIdentity(null) }
        assertThrows(ClientException::class.java) { loginIdentity(Principal { "employee-id" }) }
        assertTrue(policy.allowsOrigin("https://team-canvas.example.internal"))
        assertFalse(policy.allowsOrigin("https://team-canvas.example.internal.attacker.test"))
        assertFalse(policy.allowsOrigin(null))
    }

    @Test
    fun `rate limits reject excess requests and bound cache cardinality`() {
        val limits = RequestLimits()
        limits.require("user", 1, 60_000)
        assertThrows(ClientException::class.java) { limits.require("user", 1, 60_000) }
        for (index in 1 until 4096) limits.require("user-$index", 1, 60_000)
        assertThrows(ClientException::class.java) { limits.require("overflow", 1, 60_000) }
    }

    @Test
    fun `byte budgets reject excess weight without overflowing their counter`() {
        val limits = RequestLimits()
        limits.require("bytes", 8_000_000, 60_000, 7_000_000)
        repeat(100) {
            assertThrows(ClientException::class.java) {
                limits.require("bytes", 8_000_000, 60_000, 2_000_000)
            }
        }
        limits.require("bytes", 8_000_000, 60_000, 1_000_000)
        assertThrows(ClientException::class.java) { limits.require("bytes", 8_000_000, 60_000, 1) }
    }
}
