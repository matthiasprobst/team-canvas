package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

internal fun canvasName(value: String): String =
    value.trim().also {
        if (it.isEmpty() || it.length > 120 || it.any(Char::isISOControl))
            throw ClientException("bad_request", "Use a canvas name between 1 and 120 characters.")
    }

data class CanvasMember(val id: UUID, val displayName: String, val role: String, val revoked: Boolean, val accountId: UUID, val username: String?, val accountStatus: String)
data class CanvasMembers(val items: List<CanvasMember>, val templateVisibility: String?)
data class MemberAccessRequest(val revoked: Boolean? = null)

@ApplicationScoped
class CanvasAccess
@Inject
constructor(private val repository: BoardRepository, private val accounts: Accounts) {
    fun create(name: String, identity: LoginIdentity): CreatedBoard {
        val title = canvasName(name)
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.limits.requireOwnedSlot(c, user.id)
            accounts.requireLogin(c, user.id, identity.sid)
            val id = UUID.randomUUID()
            c.update("INSERT INTO boards(id,name,owner_user_id) VALUES(?,?,?)", id, title, user.id)
            c.update(
                "INSERT INTO participants(id,board_id,user_id,name,role) VALUES(?,?,?,?,'host')",
                UUID.randomUUID(),
                id,
                user.id,
                user.displayName,
            )
            CreatedBoard(id, title)
        }
    }

    fun join(id: UUID, request: JoinRequest, identity: LoginIdentity): JoinedBoard {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            val member =
                c.query(
                    "SELECT id,role,revoked FROM participants WHERE board_id=? AND user_id=?",
                    id,
                    user.id,
                ) {
                    if (it.next())
                        Triple(it.getObject(1, UUID::class.java), it.getString(2), it.getBoolean(3))
                    else null
                }
            if (member?.third == true)
                throw ClientException("not_found", "Canvas not found or access is unavailable.")
            if (request.inviteKey != null) invitation(c, id, request.inviteKey)
            if (member == null) {
                invitation(c, id, request.inviteKey ?: "")
                if (
                    c.query("SELECT count(*) FROM participants WHERE board_id=?", id) {
                            it.next()
                            it.getInt(1)
                        } >= 200
                )
                    throw ClientException("limit", "This canvas has reached its membership limit.")
                c.update(
                    "INSERT INTO participants(id,board_id,user_id,name,role) VALUES(?,?,?,?,'guest')",
                    UUID.randomUUID(),
                    id,
                    user.id,
                    user.displayName,
                )
            }
            val participant =
                c.query(
                    "UPDATE participants SET name=?,last_opened_at=now() WHERE board_id=? AND user_id=? RETURNING id,role",
                    user.displayName,
                    id,
                    user.id,
                ) {
                    it.next()
                    it.getObject(1, UUID::class.java) to it.getString(2)
                }
            val token = Security.token()
            c.update("DELETE FROM board_sessions WHERE user_id=? AND expires_at<now()", user.id)
            c.update(
                "INSERT INTO board_sessions(token_hash,participant_id,user_id,sid) VALUES(?,?,?,?)",
                Security.hash(token),
                participant.first,
                user.id,
                identity.sid,
            )
            JoinedBoard(id, participant.first, participant.second, token)
        }
    }

    fun authenticate(id: UUID, token: String, identity: LoginIdentity): Participant {
        if (token.length != 43)
            throw ClientException("unauthorized", "Canvas access expired or was revoked.")
        return repository.transaction { c ->
            c.query(
                """SELECT p.id,p.name,CASE WHEN b.owner_user_id=p.user_id THEN 'host' ELSE 'guest' END FROM board_sessions s
                JOIN participants p ON p.id=s.participant_id AND p.user_id=s.user_id
                JOIN boards b ON b.id=p.board_id
                JOIN app_users u ON u.id=s.user_id
                JOIN login_sessions l ON l.user_id=s.user_id AND l.sid=s.sid
                WHERE p.board_id=? AND s.token_hash=? AND u.issuer=? AND u.subject=? AND s.sid=?
                AND NOT p.revoked AND NOT s.revoked AND NOT l.revoked AND s.expires_at>now() AND u.status='active'""",
                id,
                Security.hash(token),
                identity.issuer,
                identity.subject,
                identity.sid,
            ) {
                if (!it.next())
                    throw ClientException("unauthorized", "Canvas access expired or was revoked.")
                Participant(
                    it.getObject(1, UUID::class.java),
                    id,
                    it.getString(2),
                    it.getString(3),
                    identity.subject,
                    Security.hash(token),
                )
            }
        }
    }

    private fun invitation(c: Connection, id: UUID, key: String) {
        if (
            key.length != 43 ||
                !c.query(
                    "SELECT 1 FROM board_invitations WHERE board_id=? AND secret_hash=? AND NOT revoked AND expires_at>now()",
                    id,
                    Security.hash(key),
                ) {
                    it.next()
                }
        )
            throw ClientException("not_found", "Canvas not found or access is unavailable.")
    }

    fun preview(id: UUID, key: String, identity: LoginIdentity): Map<String, String> {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            invitation(c, id, key)
            c.query(
                "SELECT b.name,u.display_name FROM boards b JOIN app_users u ON u.id=b.owner_user_id WHERE b.id=?",
                id,
            ) {
                if (!it.next())
                    throw ClientException("not_found", "Canvas not found or access is unavailable.")
                mapOf("name" to it.getString(1), "ownerName" to it.getString(2))
            }
        }
    }

    fun requireOwner(c: Connection, id: UUID, user: Account) {
        if (
            !c.query("SELECT 1 FROM boards WHERE id=? AND owner_user_id=?", id, user.id) {
                it.next()
            }
        )
            throw ClientException("not_found", "Canvas not found or access is unavailable.")
    }

    fun invite(id: UUID, identity: LoginIdentity): Map<String, String> {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            requireOwner(c, id, user)
            val active = c.query("SELECT count(*) FROM board_invitations WHERE board_id=? AND NOT revoked AND expires_at>now()", id) { it.next(); it.getInt(1) }
            if (active >= 20) throw ClientException("limit", "A canvas can have at most 20 active invitation links.")
            val key = Security.token()
            c.update(
                "INSERT INTO board_invitations(id,board_id,creator_id,secret_hash) VALUES(?,?,?,?)",
                UUID.randomUUID(),
                id,
                user.id,
                Security.hash(key),
            )
            val expiry = c.query("SELECT expires_at FROM board_invitations WHERE board_id=? AND secret_hash=?", id, Security.hash(key)) { it.next(); it.getTimestamp(1).toInstant().toString() }
            mapOf("inviteKey" to key, "expiresAt" to expiry)
        }
    }

    fun members(id: UUID, identity: LoginIdentity): CanvasMembers {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            requireOwner(c, id, user)
            val visibility = c.query("SELECT template_visibility FROM boards WHERE id=?", id) { it.next(); it.getString(1) }
            CanvasMembers(c.query(
                """SELECT p.id,u.display_name,p.user_id=b.owner_user_id AS owner,p.revoked,u.id,u.username,u.status
                FROM participants p JOIN app_users u ON u.id=p.user_id
                JOIN boards b ON b.id=p.board_id WHERE p.board_id=?
                ORDER BY owner DESC,p.revoked,lower(u.display_name),p.id""",
                id,
            ) { rows ->
                buildList {
                    while (rows.next()) add(CanvasMember(
                        rows.getObject(1, UUID::class.java),
                        rows.getString(2),
                        if (rows.getBoolean(3)) "owner" else "member",
                        rows.getBoolean(4),
                        rows.getObject(5, UUID::class.java),
                        rows.getString(6),
                        rows.getString(7),
                    ))
                }
            }, visibility)
        }
    }

    fun setMemberAccess(id: UUID, memberId: UUID, revoked: Boolean, identity: LoginIdentity) {
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            requireOwner(c, id, user)
            val owner = c.query(
                """SELECT p.user_id=b.owner_user_id FROM participants p
                JOIN boards b ON b.id=p.board_id WHERE p.board_id=? AND p.id=?""",
                id, memberId,
            ) {
                if (!it.next()) throw ClientException("not_found", "Canvas member not found.")
                it.getBoolean(1)
            }
            if (owner) throw ClientException("bad_request", "The canvas owner's access cannot be changed.")
            val target = c.query("SELECT user_id,revoked FROM participants WHERE id=?", memberId) { it.next(); it.getObject(1, UUID::class.java) to it.getBoolean(2) }
            c.update("UPDATE participants SET revoked=? WHERE board_id=? AND id=?", revoked, id, memberId)
            if (revoked) c.update("UPDATE board_sessions SET revoked=true WHERE participant_id=?", memberId)
            if (target.second != revoked) recordAccess(c, id, user.id, if (revoked) "member_removed" else "member_restored", target.first)
        }
    }

    fun revoke(id: UUID, identity: LoginIdentity, revokeMembers: Boolean) {
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            requireOwner(c, id, user)
            c.update("UPDATE board_invitations SET revoked=true WHERE board_id=?", id)
            recordAccess(c, id, user.id, "invitations_revoked")
            if (revokeMembers) {
                val targets = c.query("SELECT user_id FROM participants WHERE board_id=? AND role='guest' AND NOT revoked", id) { rows -> buildList { while (rows.next()) add(rows.getObject(1, UUID::class.java)) } }
                c.update(
                    "UPDATE participants SET revoked=true WHERE board_id=? AND role='guest'",
                    id,
                )
                c.update(
                    "UPDATE board_sessions SET revoked=true WHERE participant_id IN (SELECT id FROM participants WHERE board_id=? AND role='guest')",
                    id,
                )
                targets.forEach { recordAccess(c, id, user.id, "member_removed", it) }
            }
        }
    }

    fun history(id: UUID, identity: LoginIdentity): List<AccessEvent> {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            requireOwner(c, id, user)
            c.query("""SELECT e.id,e.action,a.display_name,t.display_name,e.target_id,e.created_at
                FROM canvas_access_events e LEFT JOIN app_users a ON a.id=e.actor_id
                LEFT JOIN app_users t ON t.id=e.target_id WHERE e.board_id=? ORDER BY e.id DESC LIMIT 50""", id) { rows ->
                buildList { while (rows.next()) add(AccessEvent(rows.getLong(1), rows.getString(2), rows.getString(3), rows.getString(4), rows.getObject(5, UUID::class.java), rows.getTimestamp(6).toInstant().toString())) }
            }
        }
    }
}
