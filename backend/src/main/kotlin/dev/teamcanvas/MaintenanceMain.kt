package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermissions
import java.sql.DriverManager
import java.util.Optional

/** Standalone operator command; runs only with the backend stopped. */
object MaintenanceMain {
    @JvmStatic fun main(args: Array<String>) {
        require(args.size == 2 && args[0] in setOf("export-blocklist", "prepare-restore")) { "Usage: maintenance export-blocklist|prepare-restore FILE" }
        fun setting(name: String) = System.getenv(name)?.takeIf { it.isNotBlank() } ?: error("Missing $name")
        val blocks = IdentityBlocks(setting("IDENTITY_BLOCKING_SECRET"), Optional.ofNullable(System.getenv("TEAM_CANVAS_IDENTITY_BLOCKING_PREVIOUS_SECRETS")))
        val json = jacksonObjectMapper()
        DriverManager.getConnection(setting("JDBC_URL"), setting("DB_USER"), setting("DB_PASSWORD")).use { c ->
            c.autoCommit = false
            try {
                if (args[0] == "prepare-restore") c.createStatement().use { s -> s.queryTimeout = 5; s.executeQuery("SELECT pg_try_advisory_xact_lock(1978842491)").use { check(it.next() && it.getBoolean(1)) { "Stop the backend before maintenance" } } }
                if (args[0] == "export-blocklist") {
                    val path = Path.of(args[1])
                    Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
                    Files.writeString(path, json.writeValueAsString(RecoveryPreparation.export(c)), StandardOpenOption.WRITE)
                    println("Offboarding export written. Store it independently of database snapshots and retain its blocking key ring.")
                } else {
                    val path = Path.of(args[1])
                    require(Files.size(path) <= 16_000_000) { "Offboarding file exceeds the supported size" }
                    val saved = json.readValue<OffboardingExport>(Files.readString(path))
                    val removed = RecoveryPreparation.prepare(c, saved, blocks)
                    println("Restore prepared; identity records removed=$removed; sessions and invitations invalidated.")
                }
                c.commit()
            } catch (error: Exception) { c.rollback(); throw error }
        }
    }
}
