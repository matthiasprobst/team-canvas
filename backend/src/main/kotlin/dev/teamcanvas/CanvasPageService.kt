package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

@ApplicationScoped
class CanvasPageService @Inject constructor(
    private val repository: BoardRepository,
    private val json: ObjectMapper,
) {
    private data class CopyElement(val id: String, val body: JsonNode, val pokerCreated: Boolean)

    fun create(
        who: Participant,
        context: CommandContext,
        copyCurrent: Boolean,
        includePoker: Boolean,
    ): CommandResult = repository.command(who) command@{ connection, state ->
        repository.receipt(connection, who, context.commandId)?.let {
            return@command CommandResult(it, duplicate = true)
        }
        RoundRules.requireContext(state, context)
        requirePagesOpen(state)
        val pageId = UUID.randomUUID()
        val position = repository.pages(connection, who.boardId).size
        connection.prepareStatement(
            "INSERT INTO canvas_pages(id,board_id,position,created_by) VALUES(?,?,?,?)",
        ).use {
            it.setObject(1, pageId)
            it.setObject(2, who.boardId)
            it.setInt(3, position)
            it.setObject(4, who.id)
            it.executeUpdate()
        }
        if (copyCurrent) copyPage(connection, who, state, pageId, includePoker)
        connection.prepareStatement(
            "UPDATE boards SET current_page_id=?,epoch=epoch+1 WHERE id=?",
        ).use {
            it.setObject(1, pageId)
            it.setObject(2, who.boardId)
            it.executeUpdate()
        }
        CommandResult(repository.commitCommand(connection, who, context.commandId), transitioned = true)
    }

    fun select(who: Participant, context: CommandContext, pageId: UUID): CommandResult =
        repository.command(who) command@{ connection, state ->
            repository.receipt(connection, who, context.commandId)?.let {
                return@command CommandResult(it, duplicate = true)
            }
            RoundRules.requireContext(state, context)
            requirePagesOpen(state)
            val exists = connection.prepareStatement(
                "SELECT 1 FROM canvas_pages WHERE board_id=? AND id=?",
            ).use {
                it.setObject(1, who.boardId)
                it.setObject(2, pageId)
                it.executeQuery().use { rows -> rows.next() }
            }
            if (!exists) throw ClientException("not_found", "Page not found.")
            if (pageId == state.pageId)
                return@command CommandResult(repository.commitCommand(connection, who, context.commandId))
            connection.prepareStatement(
                "UPDATE boards SET current_page_id=?,epoch=epoch+1 WHERE id=?",
            ).use {
                it.setObject(1, pageId)
                it.setObject(2, who.boardId)
                it.executeUpdate()
            }
            CommandResult(repository.commitCommand(connection, who, context.commandId), transitioned = true)
        }

    private fun requirePagesOpen(state: BoardState) {
        if (state.mode == "poker")
            throw ClientException("poker_active", "Finish or cancel the poker round before changing pages.")
    }

    private fun copyPage(
        connection: Connection,
        who: Participant,
        state: BoardState,
        targetPage: UUID,
        includePoker: Boolean,
    ) {
        val source = connection.prepareStatement(
            "SELECT id,body,poker_created FROM elements WHERE board_id=? AND page_id=? AND scope='public' ORDER BY id",
        ).use {
            it.setObject(1, who.boardId)
            it.setObject(2, state.pageId)
            it.executeQuery().use { rows -> buildList {
                while (rows.next()) {
                    val pokerCreated = rows.getBoolean(3)
                    if (includePoker || !pokerCreated)
                        add(CopyElement(rows.getString(1), json.readTree(rows.getString(2)), pokerCreated))
                }
            } }
        }
        val elementIds = mutableMapOf<String, String>()
        val fileIds = mutableMapOf<String, String>()
        source.forEach { element ->
            elementIds[element.id] = newObjectId()
            if (element.body.path("type").asText() == "image" && !element.body.path("isDeleted").asBoolean()) {
                val oldFileId = element.body.path("fileId").asText("")
                if (oldFileId.isNotEmpty()) fileIds.putIfAbsent(oldFileId, newObjectId())
            }
        }
        val files = readFiles(connection, who.boardId, state.pageId, fileIds.keys)
        for ((oldId, newId) in fileIds) {
            val file = files[oldId] ?: continue
            val copy = file.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>()
            copy.put("id", newId)
            saveCopy(connection, "assets", who, targetPage, newId, copy, false)
        }
        for (element in source) {
            val copy = element.body.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>()
            copy.put("id", elementIds.getValue(element.id))
            if (copy.path("type").asText() == "image") {
                val remapped = fileIds[copy.path("fileId").asText()]
                if (remapped != null) copy.put("fileId", remapped)
            }
            saveCopy(connection, "elements", who, targetPage, elementIds.getValue(element.id), copy, element.pokerCreated)
        }
    }

    private fun readFiles(connection: Connection, boardId: UUID, pageId: UUID, ids: Set<String>): Map<String, JsonNode> {
        if (ids.isEmpty()) return emptyMap()
        return connection.prepareStatement(
            "SELECT id,body FROM assets WHERE board_id=? AND page_id=? AND scope='public' AND id = ANY(?)",
        ).use {
            it.setObject(1, boardId)
            it.setObject(2, pageId)
            it.setArray(3, connection.createArrayOf("varchar", ids.toTypedArray()))
            it.executeQuery().use { rows -> buildMap {
                while (rows.next()) put(rows.getString(1), json.readTree(rows.getString(2)))
            } }
        }
    }

    private fun saveCopy(
        connection: Connection,
        table: String,
        who: Participant,
        pageId: UUID,
        id: String,
        body: JsonNode,
        pokerCreated: Boolean,
    ) {
        val pokerColumn = if (table == "elements") ",poker_created" else ""
        val pokerValue = if (table == "elements") ",?" else ""
        connection.prepareStatement(
            "INSERT INTO $table(board_id,id,body,scope,author_id,round_id,stored_bytes,page_id$pokerColumn) VALUES(?,?,?::jsonb,'public',?,NULL,?,?$pokerValue)",
        ).use {
            it.setObject(1, who.boardId)
            it.setString(2, id)
            it.setString(3, body.toString())
            it.setObject(4, who.id)
            it.setLong(5, body.toString().toByteArray(Charsets.UTF_8).size.toLong())
            it.setObject(6, pageId)
            if (table == "elements") it.setBoolean(7, pokerCreated)
            it.executeUpdate()
        }
    }

    private fun newObjectId(): String = UUID.randomUUID().toString().replace("-", "").take(20)
}
