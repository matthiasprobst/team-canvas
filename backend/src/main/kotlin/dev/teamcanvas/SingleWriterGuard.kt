package dev.teamcanvas

import io.quarkus.runtime.Startup
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.sql.SQLException
import javax.sql.DataSource
import org.eclipse.microprofile.health.HealthCheck
import org.eclipse.microprofile.health.HealthCheckResponse
import org.eclipse.microprofile.health.Readiness
import org.jboss.logging.Logger

/** Fail closed if a second backend starts, including an accidental rolling-update overlap. */
@Startup
@ApplicationScoped
class SingleWriterGuard @Inject constructor(private val dataSource: DataSource) {
    private val log = Logger.getLogger(SingleWriterGuard::class.java)
    private var connection: Connection? = null
    private var backendPid: Int = 0

    @PostConstruct
    fun start() {
        val candidate = dataSource.connection
        try {
            candidate.createStatement().use { statement ->
                statement.queryTimeout = 5
                statement
                    .executeQuery("SELECT pg_try_advisory_lock(1978842491),pg_backend_pid()")
                    .use {
                        it.next()
                        check(it.getBoolean(1)) {
                            "Another Team Canvas backend owns this database. Run one active replica."
                        }
                        backendPid = it.getInt(2)
                    }
            }
            connection = candidate
        } catch (error: Exception) {
            candidate.close()
            throw error
        }
    }

    @Synchronized
    fun ownsDatabase(): Boolean =
        try {
            connection?.createStatement()?.use { statement ->
                statement.queryTimeout = 2
                statement.executeQuery("SELECT pg_backend_pid()").use {
                    it.next() && it.getInt(1) == backendPid
                }
            } ?: false
        } catch (_: Exception) {
            false
        }

    fun requireOwner() {
        if (!ownsDatabase())
            throw ClientException("unavailable", "The server is temporarily unavailable.")
    }

    @PreDestroy
    @Synchronized
    fun close() {
        val owned = connection ?: return
        connection = null
        try {
            if (!owned.isClosed) {
                owned.createStatement().use {
                    it.execute("SELECT pg_advisory_unlock(1978842491)")
                }
            }
        } catch (error: SQLException) {
            // Closing the underlying PostgreSQL session also releases its advisory lock.
            // The pool may already be closing this session during application shutdown.
            log.debugf("Writer connection unavailable during shutdown sqlState=%s", error.sqlState)
        } finally {
            try {
                owned.close()
            } catch (error: SQLException) {
                log.debugf("Writer connection already closed during shutdown sqlState=%s", error.sqlState)
            }
        }
    }
}

@Readiness
@ApplicationScoped
class WriterReadiness @Inject constructor(private val writer: SingleWriterGuard) : HealthCheck {
    override fun call(): HealthCheckResponse =
        HealthCheckResponse.named("single-writer").status(writer.ownsDatabase()).build()
}
