package dev.teamcanvas

import java.sql.DriverManager
import org.flywaydb.core.Flyway

/** Standalone entry point: no Quarkus boot, HTTP server, OIDC or application writer. */
object MigrationMain {
    @JvmStatic
    fun main(args: Array<String>) {
        require(args.isEmpty()) { "Migration command accepts no arguments" }
        fun setting(name: String): String = System.getenv(name)?.takeIf { it.isNotBlank() }
            ?: error("Missing $name")
        val url = setting("JDBC_URL")
        val user = setting("DB_USER")
        val password = setting("DB_PASSWORD")
        DriverManager.getConnection(url, user, password).use { lease ->
            lease.createStatement().use { statement ->
                statement.queryTimeout = 5
                statement.executeQuery("SELECT pg_try_advisory_lock(1978842491)").use {
                    check(it.next() && it.getBoolean(1)) { "Stop the application before migrating" }
                }
            }
            Flyway.configure().dataSource(url, user, password).cleanDisabled(true)
                .locations("classpath:db/migration").load().migrate()
        }
    }
}
