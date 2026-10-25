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
import org.eclipse.microprofile.health.Liveness
import org.jboss.logging.Logger

/** Fail closed if a second backend starts, including an accidental rolling-update overlap. */
@Startup
@ApplicationScoped
class SingleWriterGuard @Inject constructor(private val dataSource: DataSource) {
    private val log = Logger.getLogger(SingleWriterGuard::class.java)
    private var connection: Connection? = null
    private var backendPid: Int = 0
    private enum class State { NEW, OWNED, LOST, CLOSED }
    private var state = State.NEW

    @PostConstruct
    @Synchronized
    fun start() {
        check(state == State.NEW) { "Writer ownership can only be acquired during startup." }
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
            state = State.OWNED
        } catch (error: Exception) {
            candidate.close()
            throw error
        }
    }

    @Synchronized
    fun ownsDatabase(): Boolean {
        if (state != State.OWNED) return false
        val owned = try {
            connection?.createStatement()?.use { statement ->
                statement.queryTimeout = 2
                // A pool/proxy can retain the PID after releasing session locks. Check the
                // original bigint advisory lock too, without acquiring it again.
                statement.executeQuery("""SELECT pg_backend_pid(),EXISTS(
                    SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
                    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
                    AND classid=0 AND objid=1978842491 AND objsubid=1 AND granted)""").use {
                    it.next() && it.getInt(1) == backendPid && it.getBoolean(2)
                }
            } ?: false
        } catch (_: Exception) {
            false
        }
        if (!owned) {
            state = State.LOST
            log.error("Database writer ownership lost. Restart this backend before serving more requests.")
        }
        return owned
    }

    /** Initialisation and deliberate shutdown are not an unexpected ownership loss. */
    @Synchronized
    fun isAlive(): Boolean {
        if (state == State.OWNED) ownsDatabase()
        return state != State.LOST
    }

    fun requireOwner() {
        if (!ownsDatabase())
            throw ClientException("unavailable", "The server is temporarily unavailable.")
    }

    @PreDestroy
    @Synchronized
    fun close() {
        state = State.CLOSED
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

@Liveness
@ApplicationScoped
class WriterLiveness @Inject constructor(private val writer: SingleWriterGuard) : HealthCheck {
    override fun call(): HealthCheckResponse =
        HealthCheckResponse.named("single-writer-lifecycle").status(writer.isAlive()).build()
}
