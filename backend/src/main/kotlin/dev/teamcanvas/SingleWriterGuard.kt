package dev.teamcanvas

import io.quarkus.runtime.Startup
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import javax.sql.DataSource
import org.eclipse.microprofile.health.HealthCheck
import org.eclipse.microprofile.health.HealthCheckResponse
import org.eclipse.microprofile.health.Readiness

/** Fail closed if a second backend starts, including an accidental rolling-update overlap. */
@Startup
@ApplicationScoped
class SingleWriterGuard @Inject constructor(private val dataSource: DataSource) {
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
        try {
            connection?.createStatement()?.use {
                it.execute("SELECT pg_advisory_unlock(1978842491)")
            }
        } finally {
            connection?.close()
            connection = null
        }
    }
}

@Readiness
@ApplicationScoped
class WriterReadiness @Inject constructor(private val writer: SingleWriterGuard) : HealthCheck {
    override fun call(): HealthCheckResponse =
        HealthCheckResponse.named("single-writer").status(writer.ownsDatabase()).build()
}
