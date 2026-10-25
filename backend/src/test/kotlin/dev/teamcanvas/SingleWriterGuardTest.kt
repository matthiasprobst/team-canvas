package dev.teamcanvas

import java.lang.reflect.Proxy
import java.sql.Connection
import java.sql.ResultSet
import java.sql.SQLException
import java.sql.Statement
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SingleWriterGuardTest {
    private class Lease {
        var closed = false
        var failUnlock = false
        var unlocks = 0
        var closes = 0
        private val rows = proxy<ResultSet> { method ->
            when (method) {
                "next", "getBoolean" -> true
                "getInt" -> 42
                else -> null
            }
        }
        private val statement = proxy<Statement> { method ->
            when (method) {
                "executeQuery" -> rows
                "execute" -> {
                    unlocks++
                    if (failUnlock) throw SQLException("Pool is closing")
                    true
                }
                else -> null
            }
        }
        private val connection = proxy<Connection> { method ->
            when (method) {
                "isClosed" -> closed
                "createStatement" -> statement
                "close" -> { closes++; closed = true; null }
                else -> null
            }
        }
        val guard = SingleWriterGuard(proxy<DataSource> { connection }).also { it.start() }
    }

    @Test
    fun `shutdown tolerates a connection already closed by the pool`() {
        val lease = Lease()
        lease.closed = true
        assertDoesNotThrow { lease.guard.close() }
        lease.guard.close()
        assertEquals(0, lease.unlocks)
        assertEquals(1, lease.closes)
        assertFalse(lease.guard.ownsDatabase())
    }

    @Test
    fun `shutdown still closes the connection if unlocking fails`() {
        val lease = Lease()
        lease.failUnlock = true
        assertDoesNotThrow { lease.guard.close() }
        lease.guard.close()
        assertEquals(1, lease.unlocks)
        assertEquals(1, lease.closes)
        assertFalse(lease.guard.ownsDatabase())
    }

    companion object {
        private inline fun <reified T> proxy(crossinline answer: (String) -> Any?): T =
            Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ -> answer(method.name) } as T
    }
}
