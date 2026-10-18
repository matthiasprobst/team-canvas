package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

/** Application service for board access and scenes. Round transitions live in RoundService. */
@ApplicationScoped
class BoardStore
@Inject
constructor(private val repository: BoardRepository, private val json: ObjectMapper) {
    fun create(rawName: String, subject: String? = null): CreatedBoard =
        repository.transaction { connection ->
            val id = UUID.randomUUID()
            val hostKey = Security.token()
            val inviteKey = Security.token()
            connection
                .prepareStatement(
                    "INSERT INTO boards(id,name,host_key_hash,invite_key_hash,owner_subject) VALUES(?,?,?,?,?)"
                )
                .use {
                    it.setObject(1, id)
                    it.setString(2, rawName.trim().ifEmpty { "Neues Board" }.take(120))
                    it.setString(3, Security.hash(hostKey))
                    it.setString(4, Security.hash(inviteKey))
                    it.setString(5, subject)
                    it.executeUpdate()
                }
            CreatedBoard(id, hostKey, inviteKey)
        }

    fun join(id: UUID, request: JoinRequest, subject: String? = null): JoinedBoard =
        repository.transaction { connection ->
            repository.board(connection, id)
            if (request.token != null) {
                val existing =
                    findParticipant(connection, id, request.token, subject)
                        ?: throw ClientException(
                            "unauthorized",
                            "Zugang abgelaufen oder widerrufen",
                        )
                return@transaction JoinedBoard(id, existing.id, existing.role, request.token)
            }
            val keys =
                connection
                    .prepareStatement(
                        "SELECT host_key_hash,invite_key_hash,owner_subject FROM boards WHERE id=?"
                    )
                    .use {
                        it.setObject(1, id)
                        it.executeQuery().use { rows ->
                            rows.next()
                            Triple(rows.getString(1), rows.getString(2), rows.getString(3))
                        }
                    }
            val host =
                validKey(request.hostKey, keys.first) &&
                    (keys.third == null || keys.third == subject)
            val existing =
                if (subject == null) null
                else
                    connection
                        .prepareStatement(
                            "SELECT id,name,role FROM participants WHERE board_id=? AND subject=? AND revoked=false ORDER BY created_at LIMIT 1"
                        )
                        .use {
                            it.setObject(1, id)
                            it.setString(2, subject)
                            it.executeQuery().use { rows ->
                                if (rows.next())
                                    Participant(
                                        rows.getObject(1, UUID::class.java),
                                        id,
                                        rows.getString(2),
                                        rows.getString(3),
                                        subject,
                                    )
                                else null
                            }
                        }
            if (!host && existing == null && !validKey(request.inviteKey, keys.second))
                throw ClientException("forbidden", "Eine gültige Einladung ist erforderlich")
            val name = request.name.trim()
            if (name.isEmpty() || name.length > 48)
                throw ClientException("invalid_name", "Name muss 1–48 Zeichen lang sein")
            val count =
                connection
                    .prepareStatement("SELECT count(*) FROM participants WHERE board_id=?")
                    .use {
                        it.setObject(1, id)
                        it.executeQuery().use { rows ->
                            rows.next()
                            rows.getInt(1)
                        }
                    }
            if (existing == null && count >= 200)
                throw ClientException("limit", "Teilnehmerlimit erreicht")
            val participantId = existing?.id ?: UUID.randomUUID()
            val role = if (host) "host" else existing?.role ?: "guest"
            val token = Security.token()
            connection
                .prepareStatement(
                    """
                    INSERT INTO participants(id,board_id,name,role,token_hash,subject) VALUES(?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=now()+interval '1 day',role=EXCLUDED.role
                    """
                        .trimIndent()
                )
                .use {
                    it.setObject(1, participantId)
                    it.setObject(2, id)
                    it.setString(3, name)
                    it.setString(4, role)
                    it.setString(5, Security.hash(token))
                    it.setString(6, subject)
                    it.executeUpdate()
                }
            if (host && subject != null && keys.third == null)
                connection.prepareStatement("UPDATE boards SET owner_subject=? WHERE id=?").use {
                    it.setString(1, subject)
                    it.setObject(2, id)
                    it.executeUpdate()
                }
            JoinedBoard(id, participantId, role, token)
        }

    private fun validKey(value: String?, hash: String?): Boolean =
        value != null &&
            value.length in 32..128 &&
            hash != null &&
            Security.equalHashes(Security.hash(value), hash)

    private fun findParticipant(
        connection: Connection,
        id: UUID,
        token: String,
        subject: String?,
    ): Participant? {
        if (token.length !in 32..128) return null
        return connection
            .prepareStatement(
                """
                SELECT id,name,role,subject FROM participants WHERE board_id=? AND token_hash=?
                AND revoked=false AND expires_at>now()
                """
                    .trimIndent()
            )
            .use {
                it.setObject(1, id)
                it.setString(2, Security.hash(token))
                it.executeQuery().use { rows ->
                    if (!rows.next() || rows.getString("subject") != subject) null
                    else
                        Participant(
                            rows.getObject("id", UUID::class.java),
                            id,
                            rows.getString("name"),
                            rows.getString("role"),
                            subject,
                        )
                }
            }
    }

    fun authenticate(id: UUID, token: String, subject: String? = null): Participant =
        repository.transaction {
            findParticipant(it, id, token, subject)
                ?: throw ClientException("unauthorized", "Zugang abgelaufen oder widerrufen")
        }

    fun snapshot(who: Participant): SceneSnapshot =
        repository.command(who) { connection, state ->
            val rows =
                connection
                    .prepareStatement(
                        """
                        SELECT id,body,scope FROM elements WHERE board_id=? AND
                        (scope='public' OR (scope='private' AND author_id=? AND round_id=?))
                        ORDER BY body->>'index' COLLATE "C" NULLS LAST,id
                        """
                            .trimIndent()
                    )
                    .use {
                        it.setObject(1, who.boardId)
                        it.setObject(2, who.id)
                        it.setObject(3, state.roundId)
                        it.executeQuery().use { data ->
                            buildList {
                                while (data.next()) add(
                                    Triple(
                                        data.getString(1),
                                        ElementValidation.validateElements(
                                                json
                                                    .createArrayNode()
                                                    .add(json.readTree(data.getString(2)))
                                            )
                                            .single(),
                                        data.getString(3),
                                    )
                                )
                            }
                        }
                    }
            val elements = rows.map { it.second }
            val fileIds =
                elements
                    .filter {
                        it.path("type").asText() == "image" && !it.path("isDeleted").asBoolean()
                    }
                    .map { it.path("fileId").asText() }
                    .distinct()
            SceneSnapshot(
                state,
                repository.round(connection, state, who),
                elements,
                rows.filter { it.third == "public" }.map { it.first },
                fileIds,
                who.id,
                who.role,
            )
        }

    fun roundState(who: Participant): Pair<BoardState, RoundState?> =
        repository.command(who) { connection, state ->
            state to repository.round(connection, state, who)
        }

    /** Files are read individually with the same visibility policy as elements. */
    fun asset(who: Participant, id: String): JsonNode =
        repository.command(who) { connection, state ->
            connection
                .prepareStatement(
                    """
                    SELECT body FROM assets WHERE board_id=? AND id=? AND
                    (scope='public' OR (scope='private' AND author_id=? AND round_id=?))
                    """
                        .trimIndent()
                )
                .use {
                    it.setObject(1, who.boardId)
                    it.setString(2, id)
                    it.setObject(3, who.id)
                    it.setObject(4, state.roundId)
                    it.executeQuery().use { rows ->
                        if (!rows.next()) throw ClientException("not_found", "Bild nicht verfügbar")
                        ElementValidation.validateFiles(
                                json
                                    .createObjectNode()
                                    .set<JsonNode>(id, json.readTree(rows.getString(1)))
                            )
                            .getValue(id)
                    }
                }
        }

    fun patch(
        who: Participant,
        context: CommandContext,
        elements: List<JsonNode>,
        files: Map<String, JsonNode>,
    ): PatchResult =
        repository.command(who) command@{ connection, state ->
            repository.receipt(connection, who, context.commandId)?.let {
                return@command PatchResult(CommandResult(it, duplicate = true), "private")
            }
            RoundRules.requireContext(state, context)
            val scope = if (state.mode == "standard") "public" else "private"
            if (scope == "private") {
                val round = repository.round(connection, state, who)
                if (round == null || !round.included || round.done)
                    throw ClientException("locked", "Dein Beitrag ist gesperrt")
            }
            val existingElements = sizes(connection, "elements", who.boardId)
            val existingAssets = sizes(connection, "assets", who.boardId)
            if (
                existingElements.keys.plus(elements.map { it.path("id").asText() }).size > 4000 ||
                    existingAssets.keys.plus(files.keys).size > 150
            )
                throw ClientException("limit", "Board-Limit erreicht")
            val sceneBytes =
                existingElements
                    .toMutableMap()
                    .apply {
                        elements.forEach {
                            put(
                                it.path("id").asText(),
                                it.toString().toByteArray(Charsets.UTF_8).size.toLong(),
                            )
                        }
                    }
                    .values
                    .sum()
            val fileBytes =
                existingAssets
                    .toMutableMap()
                    .apply {
                        files.forEach { (id, file) -> put(id, file.toString().length.toLong()) }
                    }
                    .values
                    .sum()
            if (sceneBytes > 4_000_000 || fileBytes > 32_000_000)
                throw ClientException("limit", "Speicherlimit des Boards erreicht")
            if (
                files.keys.any { id ->
                    elements.none {
                        it.path("type").asText() == "image" &&
                            !it.path("isDeleted").asBoolean() &&
                            it.path("fileId").asText() == id
                    }
                }
            )
                throw ClientException("invalid_file", "Bild ohne zugehöriges Element")
            for (element in elements) {
                val id = element.path("id").asText()
                requireOwnership(connection, "elements", who, id, scope, state.roundId)
                if (
                    element.path("type").asText() == "image" &&
                        !element.path("isDeleted").asBoolean()
                ) {
                    val fileId = element.path("fileId").asText()
                    if (!files.containsKey(fileId))
                        assetInTransaction(connection, who, fileId, state.roundId)
                }
            }
            for ((id, file) in files) {
                if (existingAssets.containsKey(id)) {
                    assetInTransaction(connection, who, id, state.roundId)
                    val previous =
                        connection
                            .prepareStatement("SELECT body FROM assets WHERE board_id=? AND id=?")
                            .use {
                                it.setObject(1, who.boardId)
                                it.setString(2, id)
                                it.executeQuery().use { rows ->
                                    rows.next()
                                    json.readTree(rows.getString(1))
                                }
                            }
                    if (
                        previous.path("dataURL") != file.path("dataURL") ||
                            previous.path("mimeType") != file.path("mimeType")
                    )
                        throw ClientException("invalid_file", "Bilddaten sind unveränderlich")
                } else save(connection, "assets", who, id, file, scope, state.roundId)
            }
            for (element in elements) save(
                connection,
                "elements",
                who,
                element.path("id").asText(),
                element,
                scope,
                state.roundId,
            )
            val ack = repository.commitCommand(connection, who, context.commandId)
            if (scope == "private")
                connection
                    .prepareStatement(
                        "UPDATE round_participants SET draft_revision=? WHERE round_id=? AND participant_id=?"
                    )
                    .use {
                        it.setLong(1, ack.revision)
                        it.setObject(2, state.roundId)
                        it.setObject(3, who.id)
                        it.executeUpdate()
                    }
            PatchResult(CommandResult(ack), scope)
        }

    private fun sizes(connection: Connection, table: String, boardId: UUID): Map<String, Long> =
        connection.prepareStatement("SELECT id,stored_bytes FROM $table WHERE board_id=?").use {
            it.setObject(1, boardId)
            it.executeQuery().use { rows ->
                buildMap { while (rows.next()) put(rows.getString(1), rows.getLong(2)) }
            }
        }

    private fun requireOwnership(
        connection: Connection,
        table: String,
        who: Participant,
        id: String,
        scope: String,
        roundId: UUID?,
    ) {
        connection
            .prepareStatement(
                "SELECT scope,author_id,round_id FROM $table WHERE board_id=? AND id=?"
            )
            .use {
                it.setObject(1, who.boardId)
                it.setString(2, id)
                it.executeQuery().use { rows ->
                    if (
                        rows.next() &&
                            (rows.getString(1) != scope ||
                                (scope == "private" &&
                                    (rows.getObject(2, UUID::class.java) != who.id ||
                                        rows.getObject(3, UUID::class.java) != roundId)))
                    )
                        throw ClientException("forbidden", "Dieses Objekt darfst du nicht ändern")
                }
            }
    }

    private fun assetInTransaction(
        connection: Connection,
        who: Participant,
        id: String,
        roundId: UUID?,
    ) {
        val accessible =
            connection
                .prepareStatement(
                    """
                    SELECT 1 FROM assets WHERE board_id=? AND id=? AND
                    (scope='public' OR (scope='private' AND author_id=? AND round_id=?))
                    """
                        .trimIndent()
                )
                .use {
                    it.setObject(1, who.boardId)
                    it.setString(2, id)
                    it.setObject(3, who.id)
                    it.setObject(4, roundId)
                    it.executeQuery().use { rows -> rows.next() }
                }
        if (!accessible)
            throw ClientException("invalid_file", "Bilddaten fehlen oder sind nicht freigegeben")
    }

    private fun save(
        connection: Connection,
        table: String,
        who: Participant,
        id: String,
        body: JsonNode,
        scope: String,
        roundId: UUID?,
    ) {
        connection
            .prepareStatement(
                """INSERT INTO $table(board_id,id,body,scope,author_id,round_id,stored_bytes) VALUES(?,?,?::jsonb,?,?,?,?)
            ON CONFLICT(board_id,id) DO UPDATE SET body=EXCLUDED.body,stored_bytes=EXCLUDED.stored_bytes"""
            )
            .use {
                it.setObject(1, who.boardId)
                it.setString(2, id)
                it.setString(3, body.toString())
                it.setString(4, scope)
                it.setObject(5, who.id)
                it.setObject(6, roundId)
                it.setLong(7, body.toString().toByteArray(Charsets.UTF_8).size.toLong())
                it.executeUpdate()
            }
    }

    fun rotateInvitation(who: Participant, revokeGuests: Boolean): String =
        repository.command(who) { connection, state ->
            RoundRules.requireHost(who)
            if (state.mode != "standard")
                throw ClientException("invalid_state", "Bitte zuerst die Runde beenden")
            val key = Security.token()
            connection.prepareStatement("UPDATE boards SET invite_key_hash=? WHERE id=?").use {
                it.setString(1, Security.hash(key))
                it.setObject(2, who.boardId)
                it.executeUpdate()
            }
            if (revokeGuests)
                connection
                    .prepareStatement(
                        "UPDATE participants SET revoked=true WHERE board_id=? AND role='guest'"
                    )
                    .use {
                        it.setObject(1, who.boardId)
                        it.executeUpdate()
                    }
            key
        }
}
