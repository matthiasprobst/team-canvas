package dev.teamcanvas

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.util.Base64
import java.util.UUID

data class AvatarUploadRequest(val mimeType: String = "", val dataURL: String = "")

@ApplicationScoped
class CanvasAvatars @Inject constructor(
    private val repository: BoardRepository,
    private val accounts: Accounts,
    private val json: ObjectMapper,
) {
    fun list(boardId: UUID): List<CanvasAvatar> = repository.transaction { connection ->
        connection.prepareStatement(
            """SELECT a.id,a.user_id,u.display_name,u.avatar_version,u.avatar_data IS NOT NULL,a.x,a.y
            FROM canvas_avatars a JOIN app_users u ON u.id=a.user_id
            WHERE a.board_id=? ORDER BY a.created_at,a.id""".trimIndent(),
        ).use { statement ->
            statement.setObject(1, boardId)
            statement.executeQuery().use { rows ->
                buildList {
                    while (rows.next()) add(CanvasAvatar(
                        rows.getObject(1, UUID::class.java),
                        rows.getObject(2, UUID::class.java),
                        rows.getString(3),
                        rows.getLong(4),
                        rows.getBoolean(5),
                        rows.getDouble(6),
                        rows.getDouble(7),
                    ))
                }
            }
        }
    }

    fun boardsForUser(userId: UUID): List<UUID> = repository.transaction { connection ->
        connection.prepareStatement("SELECT DISTINCT board_id FROM canvas_avatars WHERE user_id=?").use {
            it.setObject(1, userId)
            it.executeQuery().use { rows -> buildList { while (rows.next()) add(rows.getObject(1, UUID::class.java)) } }
        }
    }

    fun place(who: Participant, x: Double, y: Double): List<CanvasAvatar> = mutate(who) { c ->
        val count = c.query("SELECT count(*) FROM canvas_avatars WHERE board_id=?", who.boardId) { it.next(); it.getInt(1) }
        if (count >= 1000) throw ClientException("limit", "This canvas has reached the avatar marker limit.")
        c.update("INSERT INTO canvas_avatars(id,board_id,user_id,x,y) VALUES(?,?,?,?,?)", UUID.randomUUID(), who.boardId, who.userId, coordinate(x), coordinate(y))
    }

    fun move(who: Participant, id: UUID, x: Double, y: Double): List<CanvasAvatar> = mutate(who) { c ->
        if (c.update("UPDATE canvas_avatars SET x=?,y=? WHERE board_id=? AND id=?", coordinate(x), coordinate(y), who.boardId, id) == 0)
            throw ClientException("not_found", "Avatar marker not found.")
    }

    fun remove(who: Participant, id: UUID): List<CanvasAvatar> = mutate(who) { c ->
        if (c.update("DELETE FROM canvas_avatars WHERE board_id=? AND id=?", who.boardId, id) == 0)
            throw ClientException("not_found", "Avatar marker not found.")
    }

    private fun mutate(who: Participant, action: (java.sql.Connection) -> Unit): List<CanvasAvatar> {
        repository.command(who) { connection, state ->
            if (state.mode != "standard") throw ClientException("locked", "Avatar markers are hidden during poker rounds.")
            if (who.userId == null) throw ClientException("forbidden", "An account is required to place an avatar.")
            action(connection)
        }
        return list(who.boardId)
    }

    fun upload(identity: LoginIdentity, request: AvatarUploadRequest): UUID {
        val account = accounts.current(identity)
        val file = json.createObjectNode().apply {
            put("id", "profile")
            put("mimeType", request.mimeType)
            put("dataURL", request.dataURL)
            put("created", System.currentTimeMillis())
        }
        val validated = ElementValidation.validateFiles(json.createObjectNode().set("profile", file))["profile"]!!
        val bytes = Base64.getDecoder().decode(validated.path("dataURL").asText().substringAfter(','))
        repository.transaction { connection ->
            accounts.requireLogin(connection, account.id, identity.sid)
            connection.prepareStatement("UPDATE app_users SET avatar_data=?,avatar_mime_type=?,avatar_version=avatar_version+1 WHERE id=?").use {
                it.setBytes(1, bytes)
                it.setString(2, validated.path("mimeType").asText())
                it.setObject(3, account.id)
                it.executeUpdate()
            }
        }
        return account.id
    }

    fun clear(identity: LoginIdentity): UUID {
        val account = accounts.current(identity)
        repository.transaction { connection ->
            accounts.requireLogin(connection, account.id, identity.sid)
            connection.update("UPDATE app_users SET avatar_data=NULL,avatar_mime_type=NULL,avatar_version=avatar_version+1 WHERE id=?", account.id)
        }
        return account.id
    }

    fun image(identity: LoginIdentity, userId: UUID): Pair<ByteArray, String>? {
        val account = accounts.current(identity)
        return repository.transaction { connection ->
            accounts.requireLogin(connection, account.id, identity.sid)
            connection.prepareStatement("SELECT avatar_data,avatar_mime_type FROM app_users WHERE id=? AND avatar_data IS NOT NULL").use {
                it.setObject(1, userId)
                it.executeQuery().use { rows -> if (rows.next()) rows.getBytes(1) to rows.getString(2) else null }
            }
        }
    }

    private fun coordinate(value: Double): Double {
        if (!value.isFinite() || kotlin.math.abs(value) > 1_000_000.0)
            throw ClientException("bad_request", "Avatar position is invalid.")
        return value
    }
}
