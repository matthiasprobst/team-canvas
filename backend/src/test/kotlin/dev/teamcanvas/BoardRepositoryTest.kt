package dev.teamcanvas

import java.lang.reflect.Proxy
import java.sql.Connection
import java.sql.SQLException
import java.sql.Statement
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class BoardRepositoryTest {
    @Test
    fun `a rollback failure preserves the original command failure`() {
        val rollback = SQLException("Rollback failed")
        val original = ClientException("invalid_file", "Image data is missing or private.")
        val statement = proxy<Statement> { method -> if (method == "execute") false else null }
        val connection = proxy<Connection> { method ->
            when (method) {
                "createStatement" -> statement
                "rollback" -> throw rollback
                else -> null
            }
        }
        val source = proxy<DataSource> { connection }
        val thrown = assertThrows(ClientException::class.java) {
            BoardRepository(source).transaction<Unit> { throw original }
        }
        assertSame(original, thrown)
        assertEquals(listOf(rollback), thrown.suppressed.toList())
    }

    private inline fun <reified T> proxy(crossinline answer: (String) -> Any?): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ -> answer(method.name) } as T
}
