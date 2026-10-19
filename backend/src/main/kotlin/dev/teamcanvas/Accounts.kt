package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.security.Principal
import java.sql.Connection
import java.sql.ResultSet
import java.util.UUID
import org.eclipse.microprofile.jwt.JsonWebToken

data class LoginIdentity(val issuer: String, val subject: String, val sid: String, val name: String)

data class Account(val id: UUID, val displayName: String)

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

internal fun Connection.update(sql: String, vararg values: Any?): Int =
    prepareStatement(sql).use { statement ->
        values.forEachIndexed { i, value -> statement.setObject(i + 1, value) }
        statement.executeUpdate()
    }

internal fun <T> Connection.query(sql: String, vararg values: Any?, read: (ResultSet) -> T): T =
    prepareStatement(sql).use { statement ->
        values.forEachIndexed { i, value -> statement.setObject(i + 1, value) }
        statement.executeQuery().use(read)
    }

@ApplicationScoped
class Accounts @Inject constructor(private val repository: BoardRepository) {
    fun current(identity: LoginIdentity): Account =
        repository.transaction { connection ->
            val account =
                connection.query(
                    """INSERT INTO app_users(id,issuer,subject,display_name) VALUES(?,?,?,?)
            ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name,last_login_at=now()
            RETURNING id,display_name""",
                    UUID.randomUUID(),
                    identity.issuer,
                    identity.subject,
                    identity.name,
                ) { rows ->
                    rows.next()
                    Account(rows.getObject(1, UUID::class.java), rows.getString(2))
                }
            connection.update(
                "INSERT INTO login_sessions(user_id,sid) VALUES(?,?) ON CONFLICT DO NOTHING",
                account.id,
                identity.sid,
            )
            requireLogin(connection, account.id, identity.sid)
            account
        }

    fun requireLogin(connection: Connection, userId: UUID, sid: String) {
        val active =
            connection.query(
                "SELECT 1 FROM login_sessions WHERE user_id=? AND sid=? AND revoked=false FOR SHARE",
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
