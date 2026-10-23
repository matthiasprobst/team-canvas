package dev.teamcanvas

import java.sql.Connection
import java.util.UUID

/** Snapshot-independent offboarding tombstones must be re-imported before restoring access. */
data class OffboardingRecord(val fingerprint: String, val keyId: String, val action: String)
data class OffboardingExport(val version: Int = 1, val records: List<OffboardingRecord>)

object RecoveryPreparation {
    fun export(c: Connection): OffboardingExport = OffboardingExport(records = c.query("SELECT fingerprint,key_id,action FROM blocked_identities ORDER BY fingerprint") { r ->
        buildList { while (r.next()) add(OffboardingRecord(r.getString(1), r.getString(2), r.getString(3))) }
    })
    fun prepare(c: Connection, saved: OffboardingExport, blocks: IdentityBlocks): Int {
        require(saved.version == 1 && saved.records.size <= 100000) { "Invalid offboarding export version or size" }
        val keys = blocks.configuredKeys().associateBy { blocks.keyId(it) }
        require(saved.records.all { it.fingerprint.matches(Regex("[a-f0-9]{64}")) && keys.containsKey(it.keyId) && it.action in setOf("anonymize", "delete") }) {
            "Invalid offboarding record or unavailable verification key. Restore the original blocking key ring first."
        }
        for (entry in saved.records) c.update("INSERT INTO blocked_identities(fingerprint,key_id,action) VALUES(?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET action=CASE WHEN blocked_identities.action='delete' THEN 'delete' ELSE EXCLUDED.action END", entry.fingerprint, entry.keyId, entry.action)
        val records = export(c).records.associateBy { it.fingerprint }
        require(records.values.all { keys.containsKey(it.keyId) }) { "Missing a blocking key from restored database state" }
        val users = c.query("SELECT id,issuer,subject FROM app_users WHERE status<>'placeholder'") { r -> buildList { while (r.next()) add(Triple(r.getObject(1, UUID::class.java), r.getString(2), r.getString(3))) } }
        var erased = 0
        for ((id, issuer, subject) in users) {
            val matches = keys.values.mapNotNull { records[blocks.fingerprint(it, issuer, subject)] }
            if (matches.isEmpty()) continue
            if (matches.any { it.action == "delete" }) c.update("DELETE FROM boards WHERE owner_user_id=?", id)
            else {
                val replacement = UUID.randomUUID()
                val number = c.query("SELECT nextval('deleted_user_number')") { it.next(); it.getLong(1) }
                c.update("INSERT INTO app_users(id,display_name,status) VALUES(?,?,'placeholder')", replacement, "deleted_user_$number")
                c.update("UPDATE boards SET owner_user_id=? WHERE owner_user_id=?", replacement, id)
            }
            c.update("UPDATE board_invitations SET revoked=true WHERE creator_id=?", id)
            c.update("DELETE FROM app_users WHERE id=?", id)
            erased++
        }
        c.update("DELETE FROM board_sessions")
        c.update("UPDATE login_sessions SET revoked=true")
        c.update("UPDATE board_invitations SET revoked=true")
        return erased
    }
}
