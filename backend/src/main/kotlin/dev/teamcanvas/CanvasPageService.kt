package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

@ApplicationScoped
class CanvasPageService @Inject constructor(
    private val repository: BoardRepository,
    private val scenes: SceneRepository,
) {
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
        val source = scenes.publicPageElements(connection, who.boardId, state.pageId)
            .filter { includePoker || !it.pokerCreated }
        val mapping = PageCopy(source.map { it.body })
        val files = scenes.publicAssets(connection, who.boardId, state.pageId, mapping.fileIds.keys)
        for ((oldId, newId) in mapping.fileIds) {
            val file = files[oldId] ?: continue
            val copy = file.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>()
            copy.put("id", newId)
            scenes.insertCopy(connection, SceneTable.ASSETS, who, targetPage, newId, copy, false)
        }
        for (element in source) {
            val copy = mapping.element(element.body)
            scenes.insertCopy(connection, SceneTable.ELEMENTS, who, targetPage, copy.path("id").asText(), copy, element.pokerCreated)
        }
    }

}
