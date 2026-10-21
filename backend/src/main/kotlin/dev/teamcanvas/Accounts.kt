package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.security.Principal
import java.sql.Connection
import java.util.UUID
import org.eclipse.microprofile.jwt.JsonWebToken

data class LoginIdentity(val issuer: String, val subject: String, val sid: String, val name: String)

data class Account(val id: UUID, val displayName: String, val limits: LimitSettings = LimitSettings(10, 20), val admin: Boolean = false)

/** Accept identities only from the JWT principal validated by Quarkus OIDC. */
fun loginIdentity(principal: Principal?): LoginIdentity {
    val jwt = principal as? JsonWebToken ?: throw ClientException("unauthorized", "Please sign in.")
    val issuer = jwt.issuer
    val subject = jwt.subject
    val sid = jwt.getClaim<String>("sid")
    if (
        issuer.isNullOrBlank() ||
            issuer.length > 2048 ||
            subject.isNullOrBlank() ||
            subject.length > 512 ||
            sid.isNullOrBlank() ||
            sid.length > 512 ||
            jwt.expirationTime <= System.currentTimeMillis() / 1000
    )
        throw ClientException("unauthorized", "Your sign-in session is invalid or expired.")
    val name =
        (jwt.getClaim<String>("name") ?: jwt.getClaim<String>("preferred_username") ?: "User")
            .trim()
            .ifEmpty { "User" }
            .take(48)
    return LoginIdentity(issuer, subject, sid, name)
}

@ApplicationScoped
class Accounts @Inject constructor(private val repository: BoardRepository, private val blocks: IdentityBlocks = IdentityBlocks()) {
    fun current(identity: LoginIdentity): Account =
        repository.transaction { connection ->
            blocks.lock(connection, identity.issuer, identity.subject)
            blocks.requireAllowed(connection, identity.issuer, identity.subject)
            val account =
                connection.query(
                    """INSERT INTO app_users(id,issuer,subject,display_name) VALUES(?,?,?,?)
            ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name,last_login_at=now()
            WHERE app_users.status='active'
            RETURNING id,display_name""",
                    UUID.randomUUID(),
                    identity.issuer,
                    identity.subject,
                    identity.name,
                ) { rows ->
                    if (!rows.next()) throw ClientException("unauthorized", "This account is deactivated.")
                    Account(rows.getObject(1, UUID::class.java), rows.getString(2))
                }
            connection.update(
                "INSERT INTO login_sessions(user_id,sid) VALUES(?,?) ON CONFLICT DO NOTHING",
                account.id,
                identity.sid,
            )
            requireLogin(connection, account.id, identity.sid)
            account.copy(limits = repository.limits.settings())
        }

    fun requireLogin(connection: Connection, userId: UUID, sid: String) {
        val active =
            connection.query(
                "SELECT 1 FROM login_sessions l JOIN app_users u ON u.id=l.user_id WHERE l.user_id=? AND l.sid=? AND NOT l.revoked AND u.status='active' FOR SHARE OF l,u",
                userId,
                sid,
            ) {
                it.next()
            }
        if (!active) throw ClientException("unauthorized", "Please sign in again.")
    }

    fun logout(identity: LoginIdentity) {
        val account = current(identity)
        repository.transaction { connection ->
            connection.update(
                "UPDATE login_sessions SET revoked=true WHERE user_id=? AND sid=?",
                account.id,
                identity.sid,
            )
            connection.update(
                "UPDATE board_sessions SET revoked=true WHERE user_id=? AND sid=?",
                account.id,
                identity.sid,
            )
        }
    }
}
