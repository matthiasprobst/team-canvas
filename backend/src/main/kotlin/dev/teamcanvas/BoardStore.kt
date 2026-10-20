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
                        SELECT id,body,scope,poker_created FROM elements WHERE board_id=? AND page_id=? AND
                        (scope='public' OR (scope='private' AND author_id=? AND round_id=?))
                        ORDER BY body->>'index' COLLATE "C" NULLS LAST,id
                        """
                            .trimIndent()
                    )
                    .use {
                        it.setObject(1, who.boardId)
                        it.setObject(2, state.pageId)
                        it.setObject(3, who.id)
                        it.setObject(4, state.roundId)
                        it.executeQuery().use { data ->
                            buildList {
                                while (data.next()) add(
                                    StoredElement(
                                        data.getString(1),
                                        ElementValidation.validateElements(
                                                json
                                                    .createArrayNode()
                                                    .add(json.readTree(data.getString(2)))
                                            )
                                            .single(),
                                        data.getString(3),
                                        data.getBoolean(4),
                                    )
                                )
                            }
                        }
                    }
            val elements = rows.map { it.body }
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
                rows.filter { it.scope == "public" }.map { it.id },
                fileIds,
                who.id,
                who.role,
                repository.pages(connection, who.boardId),
                rows.filter { it.pokerCreated && !it.body.path("isDeleted").asBoolean() }.map { it.id },
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
                    SELECT body FROM assets WHERE board_id=? AND page_id=? AND id=? AND
                    (scope='public' OR (scope='private' AND author_id=? AND round_id=?))
                    """
                        .trimIndent()
                )
                .use {
                    it.setObject(1, who.boardId)
                    it.setObject(2, state.pageId)
                    it.setString(3, id)
                    it.setObject(4, who.id)
                    it.setObject(5, state.roundId)
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
            val existingElements = sizes(connection, "elements", who.boardId, state.pageId)
            val existingAssets = sizes(connection, "assets", who.boardId, state.pageId)
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
                requireOwnership(connection, "elements", who, id, scope, state.roundId, state.pageId)
                if (
                    element.path("type").asText() == "image" &&
                        !element.path("isDeleted").asBoolean()
                ) {
                    val fileId = element.path("fileId").asText()
                    if (!files.containsKey(fileId))
                        assetInTransaction(connection, who, fileId, state.roundId, state.pageId)
                }
            }
            for ((id, file) in files) {
                if (existingAssets.containsKey(id)) {
                    assetInTransaction(connection, who, id, state.roundId, state.pageId)
                    val previous =
                        connection
                            .prepareStatement("SELECT body FROM assets WHERE board_id=? AND page_id=? AND id=?")
                            .use {
                                it.setObject(1, who.boardId)
                                it.setObject(2, state.pageId)
                                it.setString(3, id)
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
                } else {
                    val usedOnOtherPage = connection.prepareStatement(
                        "SELECT 1 FROM assets WHERE board_id=? AND id=?",
                    ).use {
                        it.setObject(1, who.boardId)
                        it.setString(2, id)
                        it.executeQuery().use { rows -> rows.next() }
                    }
                    if (usedOnOtherPage) throw ClientException("forbidden", "You cannot change this image.")
                    save(connection, "assets", who, id, file, scope, state.roundId, state.pageId)
                }
            }
            for (element in elements) save(
                connection,
                "elements",
                who,
                element.path("id").asText(),
                element,
                scope,
                state.roundId,
                state.pageId,
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

    private fun sizes(connection: Connection, table: String, boardId: UUID, pageId: UUID): Map<String, Long> =
        connection.prepareStatement("SELECT id,stored_bytes FROM $table WHERE board_id=? AND page_id=?").use {
            it.setObject(1, boardId)
            it.setObject(2, pageId)
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
        pageId: UUID,
    ) {
        connection
            .prepareStatement(
                "SELECT page_id,scope,author_id,round_id FROM $table WHERE board_id=? AND id=?"
            )
            .use {
                it.setObject(1, who.boardId)
                it.setString(2, id)
                it.executeQuery().use { rows ->
                    if (
                        rows.next() &&
                            (rows.getObject(1, UUID::class.java) != pageId || rows.getString(2) != scope ||
                                (scope == "private" &&
                                    (rows.getObject(3, UUID::class.java) != who.id ||
                                        rows.getObject(4, UUID::class.java) != roundId)))
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
        pageId: UUID,
    ) {
        val accessible =
            connection
                .prepareStatement(
                    """
                    SELECT 1 FROM assets WHERE board_id=? AND page_id=? AND id=? AND
                    (scope='public' OR (scope='private' AND author_id=? AND round_id=?))
                    """
                        .trimIndent()
                )
                .use {
                    it.setObject(1, who.boardId)
                    it.setObject(2, pageId)
                    it.setString(3, id)
                    it.setObject(4, who.id)
                    it.setObject(5, roundId)
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
        pageId: UUID,
    ) {
        connection
            .prepareStatement(
            """INSERT INTO $table(board_id,id,body,scope,author_id,round_id,stored_bytes,page_id) VALUES(?,?,?::jsonb,?,?,?,?,?)
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
                it.setObject(8, pageId)
                it.executeUpdate()
            }
    }

}
