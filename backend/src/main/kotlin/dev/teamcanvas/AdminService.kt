package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.security.MessageDigest
import java.sql.Connection
import java.util.UUID

data class AdminUser(val id: UUID, val displayName: String, val status: String, val ownedCanvases: Int, val username: String? = null)
data class AdminUsers(val items: List<AdminUser>, val nextOffset: Int?)
data class ImpactCanvas(val id: UUID, val name: String)
data class UserImpact(val user: AdminUser, val canvases: List<ImpactCanvas>, val token: String)
data class LifecycleResult(val action: String, val affectedCanvases: Int)

@ApplicationScoped
class AdminService @Inject constructor(
    private val repository: BoardRepository,
    private val blocks: IdentityBlocks = IdentityBlocks(),
) {
    private val locks = Array(64) { Any() }
    private fun lock(id: UUID) = locks[Math.floorMod(id.hashCode(), locks.size)]

    fun offboardingExport(): OffboardingExport = repository.transaction { RecoveryPreparation.export(it) }

    fun list(offset: Int, query: String): AdminUsers {
        if (offset !in 0..100000 || query.length > 120) throw ClientException("bad_request", "Invalid user filters.")
        return repository.transaction { c ->
            val items = c.query("""SELECT u.id,u.display_name,u.status,u.username,(SELECT count(*) FROM boards b WHERE b.owner_user_id=u.id)
                FROM app_users u WHERE position(lower(?) in lower(u.display_name))>0 OR position(lower(?) in lower(coalesce(u.username,'')))>0 OR position(lower(?) in u.id::text)>0 ORDER BY u.id LIMIT 51 OFFSET ?""", query.trim(), query.trim(), query.trim(), offset) { rows ->
                buildList { while (rows.next()) add(AdminUser(rows.getObject(1, UUID::class.java), rows.getString(2), rows.getString(3), rows.getInt(5), rows.getString(4))) }
            }
            AdminUsers(items.take(50), if (items.size > 50) offset + 50 else null)
        }
    }

    private fun impactToken(id: UUID, status: String, name: String, username: String?, canvases: List<ImpactCanvas>): String {
        // Length-prefix every field so arbitrary canvas/user names cannot change field boundaries.
        val fields = listOf(id.toString(), status, name, username ?: "") + canvases.flatMap { listOf(it.id.toString(), it.name) }
        return blocks.impact(fields.joinToString("") { "${it.length}:$it" })
    }

    private fun impact(c: Connection, id: UUID): UserImpact {
        val user = c.query("SELECT id,display_name,status,username FROM app_users WHERE id=?", id) { r ->
            if (!r.next()) throw ClientException("not_found", "User no longer exists.")
            AdminUser(r.getObject(1, UUID::class.java), r.getString(2), r.getString(3), 0, r.getString(4))
        }
        val canvases = c.query("SELECT id,name FROM boards WHERE owner_user_id=? ORDER BY id", id) { r ->
            buildList { while (r.next()) add(ImpactCanvas(r.getObject(1, UUID::class.java), r.getString(2))) }
        }
        val token = impactToken(id, user.status, user.displayName, user.username, canvases)
        return UserImpact(user.copy(ownedCanvases = canvases.size), canvases, token)
    }
    fun impact(id: UUID): UserImpact = repository.transaction { impact(it, id) }

    fun change(actor: UUID, id: UUID, action: String, token: String, confirmation: String,
               disconnect: (String, String) -> Unit = { _, _ -> }): Pair<LifecycleResult, List<UUID>> =
        audited(actor, id, action) { changeAccount(actor, id, action, token, confirmation, disconnect) }

    fun reassign(actor: UUID, boardId: UUID, target: UUID) =
        audited(actor, target, "reassign", boardId) { reassignOwner(actor, boardId, target) }

    fun audit(): List<AdminAuditEvent> = repository.transaction { AdminAudit.list(it) }

    private fun <T> audited(actor: UUID, target: UUID, action: String, boardId: UUID? = null, operation: () -> T): T {
        try {
            return operation()
        } catch (error: ClientException) {
            repository.transaction { AdminAudit.record(it, actor, target, action, "rejected", boardId) }
            throw error
        }
    }

    private fun changeAccount(actor: UUID, id: UUID, action: String, token: String, confirmation: String,
               disconnect: (String, String) -> Unit = { _, _ -> }): Pair<LifecycleResult, List<UUID>> = synchronized(lock(id)) {
        if (id == actor) throw ClientException("forbidden", "Use another administrator for your own account lifecycle.")
        if (action !in setOf("deactivate", "reactivate", "anonymize", "delete")) throw ClientException("bad_request", "Invalid lifecycle action.")
        if (action in setOf("anonymize", "delete") && confirmation != "${action.uppercase()} $id")
            throw ClientException("bad_request", "Type ${action.uppercase()} $id to confirm this irreversible operation.")
        val identity = repository.transaction { c ->
            val preview = impact(c, id)
            if (!MessageDigest.isEqual(preview.token.toByteArray(), token.toByteArray()))
                throw ClientException("conflict", "Account impact changed. Review a fresh preview.")
            if (preview.user.status == "placeholder") throw ClientException("bad_request", "Replacement owners cannot sign in. Reassign their canvases instead.")
            val identity = c.query("SELECT issuer,subject FROM app_users WHERE id=? FOR UPDATE", id) { r -> r.next(); r.getString(1) to r.getString(2) }
            c.update("UPDATE app_users SET status=? WHERE id=?", if (action == "reactivate") "active" else "deactivated", id)
            c.update("UPDATE login_sessions SET revoked=true WHERE user_id=?", id)
            c.update("UPDATE board_sessions SET revoked=true WHERE user_id=?", id)
            AdminAudit.record(c, actor, id, action, if (action in setOf("anonymize", "delete")) "access_revoked" else "succeeded")
            identity
        }
        disconnect(identity.first, identity.second)
        if (action in setOf("deactivate", "reactivate")) {
            return@synchronized LifecycleResult(action, 0) to emptyList()
        }
        val affected = repository.transaction { c ->
            blocks.lock(c, identity.first, identity.second)
            c.query("SELECT id FROM app_users WHERE id=? FOR UPDATE", id) { if (!it.next()) throw ClientException("not_found", "User no longer exists.") }
            val preview = impact(c, id)
            // Deactivation changed status; compare the canvas snapshot independently below.
            val expected = impactToken(id, "active", preview.user.displayName, preview.user.username, preview.canvases)
            val expectedInactive = impactToken(id, "deactivated", preview.user.displayName, preview.user.username, preview.canvases)
            if (token != expected && token != expectedInactive) throw ClientException("conflict", "Canvas ownership changed. Review a fresh preview.")
            val ids = preview.canvases.map { it.id }
            ids.forEach { repository.board(c, it) }
            blocks.block(c, identity.first, identity.second, action)
            c.update("UPDATE board_invitations SET revoked=true WHERE creator_id=?", id)
            if (action == "anonymize") {
                val replacement = UUID.randomUUID()
                val number = c.query("SELECT nextval('deleted_user_number')") { it.next(); it.getLong(1) }
                c.update("INSERT INTO app_users(id,display_name,status) VALUES(?,?,'placeholder')", replacement, "deleted_user_$number")
                c.update("UPDATE boards SET owner_user_id=? WHERE owner_user_id=?", replacement, id)
            } else c.update("DELETE FROM boards WHERE owner_user_id=?", id)
            AdminAudit.record(c, actor, id, action, "succeeded")
            c.update("DELETE FROM app_users WHERE id=?", id)
            ids
        }
        LifecycleResult(action, affected.size) to affected
    }

    private fun reassignOwner(actor: UUID, boardId: UUID, target: UUID) = repository.transaction { c ->
        repository.board(c, boardId)
        val source = c.query("SELECT owner_user_id FROM boards WHERE id=?", boardId) { it.next(); it.getObject(1, UUID::class.java) }
        val sourceStatus = c.query("SELECT status FROM app_users WHERE id=?", source) { it.next(); it.getString(1) }
        if (sourceStatus != "placeholder") throw ClientException("forbidden", "Only retained replacement-owner canvases can be reassigned here.")
        repository.limits.requireOwnedSlot(c, target)
        val name = c.query("SELECT display_name FROM app_users WHERE id=? AND status='active'", target) { r ->
            if (!r.next()) throw ClientException("bad_request", "Choose an existing active account.")
            r.getString(1)
        }
        c.update("UPDATE boards SET owner_user_id=? WHERE id=?", target, boardId)
        c.update("UPDATE participants SET role='guest' WHERE board_id=?", boardId)
        c.update("INSERT INTO participants(id,board_id,user_id,name,role) VALUES(?,?,?,?,'host') ON CONFLICT(user_id,board_id) DO UPDATE SET role='host',revoked=false,name=EXCLUDED.name", UUID.randomUUID(), boardId, target, name.take(48))
        c.update("UPDATE board_sessions SET revoked=true WHERE participant_id IN (SELECT id FROM participants WHERE board_id=?)", boardId)
        c.update("UPDATE board_invitations SET revoked=true WHERE board_id=?", boardId)
        AdminAudit.record(c, actor, target, "reassign", "succeeded", boardId)
    }
}
