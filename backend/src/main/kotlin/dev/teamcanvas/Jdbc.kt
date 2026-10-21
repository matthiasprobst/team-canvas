package dev.teamcanvas

import java.sql.Connection
import java.sql.ResultSet

internal fun Connection.update(sql: String, vararg values: Any?): Int =
    prepareStatement(sql).use { statement ->
        values.forEachIndexed { i, value -> statement.setObject(i + 1, value) }
        statement.executeUpdate()
    }

internal fun <T> Connection.query(sql: String, vararg values: Any?, read: (ResultSet) -> T): T =
    prepareStatement(sql).use { statement ->
        values.forEachIndexed { i, value -> statement.setObject(i + 1, value) }
        statement.executeQuery().use(read)
    }
