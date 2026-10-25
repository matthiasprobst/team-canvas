package dev.teamcanvas

import io.quarkus.runtime.Startup
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.jboss.logging.Logger

@Startup
@ApplicationScoped
class MaintenanceTasks @Inject constructor(private val records: ExpiredRecords, private val writer: SingleWriterGuard) {
    private val executor = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "team-canvas-cleanup").apply { isDaemon = true } }
    @PostConstruct fun start() {
        executor.scheduleWithFixedDelay({
            try { writer.requireOwner(); records.runBatch() }
            catch (error: Exception) { Logger.getLogger(MaintenanceTasks::class.java).warnf("Expired record cleanup failed exception=%s", error.javaClass.simpleName) }
        }, 5, 5, TimeUnit.MINUTES)
    }
    @PreDestroy fun stop() { executor.shutdownNow() }
}
