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

@ApplicationScoped
class CanvasAccess
@Inject
constructor(private val repository: BoardRepository, private val accounts: Accounts) {
    fun create(name: String, identity: LoginIdentity): CreatedBoard {
        val title = canvasName(name)
        val user = accounts.current(identity)
        return repository.transaction { c ->
            accounts.requireLogin(c, user.id, identity.sid)
            repository.limits.requireOwnedSlot(c, user.id)
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
            if (request.inviteKey != null) invitation(c, id, request.inviteKey)
            if (member == null || member.third) {
                invitation(c, id, request.inviteKey ?: "")
                if (
                    member == null &&
                        c.query("SELECT count(*) FROM participants WHERE board_id=?", id) {
                            it.next()
                            it.getInt(1)
                        } >= 200
                )
                    throw ClientException("limit", "This canvas has reached its membership limit.")
                c.update(
                    """INSERT INTO participants(id,board_id,user_id,name,role) VALUES(?,?,?,?,'guest')
                    ON CONFLICT(user_id,board_id) DO UPDATE SET revoked=false,name=EXCLUDED.name""",
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
                AND NOT p.revoked AND NOT s.revoked AND NOT l.revoked AND s.expires_at>now()""",
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
                    "SELECT 1 FROM board_invitations WHERE board_id=? AND secret_hash=? AND NOT revoked",
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
            val key = Security.token()
            c.update(
                "INSERT INTO board_invitations(id,board_id,creator_id,secret_hash) VALUES(?,?,?,?)",
                UUID.randomUUID(),
                id,
                user.id,
                Security.hash(key),
            )
            mapOf("inviteKey" to key)
        }
    }

    fun revoke(id: UUID, identity: LoginIdentity, revokeMembers: Boolean) {
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            requireOwner(c, id, user)
            c.update("UPDATE board_invitations SET revoked=true WHERE board_id=?", id)
            if (revokeMembers) {
                c.update(
                    "UPDATE participants SET revoked=true WHERE board_id=? AND role='guest'",
                    id,
                )
                c.update(
                    "UPDATE board_sessions SET revoked=true WHERE participant_id IN (SELECT id FROM participants WHERE board_id=? AND role='guest')",
                    id,
                )
            }
        }
    }
}
