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
                        if (!rows.next()) throw ClientException("not_found", "Image not available.")
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
                    throw ClientException("locked", "Your contribution is locked.")
            }
            val existingElements = sizes(connection, "elements", who.boardId)
            val existingAssets = sizes(connection, "assets", who.boardId)
            if (
                existingElements.keys.plus(elements.map { it.path("id").asText() }).size > 4000 ||
                    existingAssets.keys.plus(files.keys).size > 150
            )
                throw ClientException("limit", "Canvas element limit reached.")
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
                throw ClientException("limit", "Canvas storage limit reached.")
            if (
                files.keys.any { id ->
                    elements.none {
                        it.path("type").asText() == "image" &&
                            !it.path("isDeleted").asBoolean() &&
                            it.path("fileId").asText() == id
                    }
                }
            )
                throw ClientException("invalid_file", "Image has no associated element.")
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
                        throw ClientException("invalid_file", "Image data cannot be changed.")
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
                        throw ClientException("forbidden", "You cannot change this object.")
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
            throw ClientException("invalid_file", "Image data is missing or private.")
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

}
