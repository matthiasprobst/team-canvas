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
constructor(
    private val repository: BoardRepository,
    private val scenes: SceneRepository,
    private val json: ObjectMapper,
) {
    fun snapshot(who: Participant): SceneSnapshot =
        repository.command(who) { connection, state ->
            val rows = scenes.visibleElements(connection, who, state).map { row ->
                row.copy(body = ElementValidation.validateElements(json.createArrayNode().add(row.body)).single())
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
            if (!scenes.accessibleAsset(connection, who, id, state.roundId, state.pageId))
                throw ClientException("not_found", "Image not available.")
            val file = scenes.asset(connection, who.boardId, state.pageId, id)
                ?: throw ClientException("not_found", "Image not available.")
            ElementValidation.validateFiles(json.createObjectNode().set<JsonNode>(id, file)).getValue(id)
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
            val existingElements = scenes.sizes(connection, SceneTable.ELEMENTS, who.boardId, state.pageId)
            val existingAssets = scenes.sizes(connection, SceneTable.ASSETS, who.boardId, state.pageId)
            if (
                existingElements.keys.plus(elements.map { it.path("id").asText() }).size > BoardLimits.ELEMENTS ||
                    existingAssets.keys.plus(files.keys).size > BoardLimits.ASSETS
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
            if (sceneBytes > BoardLimits.SCENE_BYTES || fileBytes > BoardLimits.ASSET_BYTES)
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
                requireOwnership(connection, who, id, scope, state.roundId, state.pageId)
                if (
                    element.path("type").asText() == "image" &&
                        !element.path("isDeleted").asBoolean()
                ) {
                    val fileId = element.path("fileId").asText()
                    if (!files.containsKey(fileId))
                        requireAsset(connection, who, fileId, state.roundId, state.pageId)
                }
            }
            for ((id, file) in files) {
                if (existingAssets.containsKey(id)) {
                    requireAsset(connection, who, id, state.roundId, state.pageId)
                    val previous = scenes.asset(connection, who.boardId, state.pageId, id)
                        ?: throw ClientException("invalid_file", "Image data is missing or private.")
                    if (
                        previous.path("dataURL") != file.path("dataURL") ||
                            previous.path("mimeType") != file.path("mimeType")
                    )
                        throw ClientException("invalid_file", "Image data cannot be changed.")
                } else {
                    val usedOnOtherPage = scenes.assetIdExists(connection, who.boardId, id)
                    if (usedOnOtherPage) throw ClientException("forbidden", "You cannot change this image.")
                    scenes.save(connection, SceneTable.ASSETS, who, id, file, scope, state.roundId, state.pageId)
                }
            }
            for (element in elements) scenes.save(
                connection,
                SceneTable.ELEMENTS,
                who,
                element.path("id").asText(),
                element,
                scope,
                state.roundId,
                state.pageId,
            )
            val ack = repository.commitCommand(connection, who, context.commandId)
            if (scope == "private") scenes.updateDraftRevision(connection, who, state.roundId, ack.revision)
            PatchResult(CommandResult(ack), scope)
        }

    private fun requireOwnership(
        connection: Connection, who: Participant, id: String, scope: String, roundId: UUID?, pageId: UUID,
    ) {
        val existing = scenes.ownership(connection, who.boardId, id) ?: return
        if (existing.pageId != pageId || existing.scope != scope ||
            (scope == "private" && (existing.authorId != who.id || existing.roundId != roundId)))
            throw ClientException("forbidden", "You cannot change this object.")
    }

    private fun requireAsset(connection: Connection, who: Participant, id: String, roundId: UUID?, pageId: UUID) {
        if (!scenes.accessibleAsset(connection, who, id, roundId, pageId))
            throw ClientException("invalid_file", "Image data is missing or private.")
    }
}
