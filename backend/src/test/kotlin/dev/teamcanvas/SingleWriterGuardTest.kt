package dev.teamcanvas

import java.lang.reflect.Proxy
import java.sql.Connection
import java.sql.ResultSet
import java.sql.SQLException
import java.sql.Statement
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.eclipse.microprofile.health.HealthCheckResponse

class SingleWriterGuardTest {
    private class Lease(start: Boolean = true) {
        var closed = false
        var locked = true
        var pid = 42
        var failQueries = false
        var queries = 0
        var failUnlock = false
        var unlocks = 0
        var closes = 0
        private val rows = proxy<ResultSet> { method ->
            when (method) {
                "next" -> true
                "getBoolean" -> locked
                "getInt" -> pid
                else -> null
            }
        }
        private val statement = proxy<Statement> { method ->
            when (method) {
                "executeQuery" -> {
                    queries++
                    if (failQueries || closed) throw SQLException("Connection lost")
                    rows
                }
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
        val guard = SingleWriterGuard(proxy<DataSource> { connection }).also { if (start) it.start() }
    }

    @Test
    fun `liveness allows startup and deliberate shutdown while readiness requires ownership`() {
        val lease = Lease(start = false)
        assertEquals(HealthCheckResponse.Status.UP, WriterLiveness(lease.guard).call().status)
        assertEquals(HealthCheckResponse.Status.DOWN, WriterReadiness(lease.guard).call().status)
        lease.guard.start()
        assertEquals(HealthCheckResponse.Status.UP, WriterLiveness(lease.guard).call().status)
        assertEquals(HealthCheckResponse.Status.UP, WriterReadiness(lease.guard).call().status)
        lease.guard.close()
        assertEquals(HealthCheckResponse.Status.UP, WriterLiveness(lease.guard).call().status)
        assertFalse(lease.guard.ownsDatabase())
    }

    @Test
    fun `ownership loss is permanent even if the same database session recovers`() {
        val lease = Lease()
        lease.failQueries = true
        assertFalse(lease.guard.ownsDatabase())
        lease.failQueries = false
        val queries = lease.queries
        assertFalse(lease.guard.ownsDatabase())
        assertEquals(queries, lease.queries)
        assertEquals(HealthCheckResponse.Status.DOWN, WriterLiveness(lease.guard).call().status)
        assertEquals(HealthCheckResponse.Status.DOWN, WriterReadiness(lease.guard).call().status)
        assertEquals("unavailable", assertThrows(ClientException::class.java) { lease.guard.requireOwner() }.code)
        assertThrows(IllegalStateException::class.java) { lease.guard.start() }
        lease.guard.close()
    }

    @Test
    fun `an unchanged backend pid does not prove the advisory lock is still held`() {
        val lease = Lease()
        lease.locked = false
        assertEquals(HealthCheckResponse.Status.DOWN, WriterLiveness(lease.guard).call().status)
        lease.locked = true
        assertFalse(lease.guard.ownsDatabase())
        lease.guard.close()
    }

    @Test
    fun `a replaced pooled session cannot inherit ownership`() {
        val lease = Lease()
        lease.pid++
        assertFalse(lease.guard.ownsDatabase())
        lease.pid--
        assertFalse(lease.guard.isAlive())
        lease.guard.close()
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
