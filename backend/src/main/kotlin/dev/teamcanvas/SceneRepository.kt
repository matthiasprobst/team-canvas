package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

enum class SceneTable {
    ELEMENTS, ASSETS;

    override fun toString(): String = name.lowercase(java.util.Locale.ROOT)
}

/** SQL only: callers supply the connection so policy checks and writes stay atomic. */
@ApplicationScoped
class SceneRepository @Inject constructor(private val json: ObjectMapper) {
    fun sizes(connection: Connection, table: SceneTable, boardId: UUID, pageId: UUID): Map<String, Long> =
        connection.prepareStatement("SELECT id,stored_bytes FROM $table WHERE board_id=? AND page_id=?").use {
            it.setObject(1, boardId)
            it.setObject(2, pageId)
            it.executeQuery().use { rows ->
                buildMap { while (rows.next()) put(rows.getString(1), rows.getLong(2)) }
            }
        }

    data class Ownership(val pageId: UUID, val scope: String, val draftHash: String?, val roundId: UUID?)

    fun ownership(connection: Connection, boardId: UUID, id: String): Ownership? =
        connection.query(
            "SELECT page_id,scope,draft_hash,round_id FROM elements WHERE board_id=? AND id=?",
            boardId, id,
        ) { rows ->
            if (!rows.next()) null else Ownership(
                rows.getObject(1, UUID::class.java), rows.getString(2),
                rows.getString(3), rows.getObject(4, UUID::class.java),
            )
        }

    fun accessibleAsset(connection: Connection, who: Participant, id: String, roundId: UUID?, pageId: UUID): Boolean =
        connection.query(
            """SELECT 1 FROM assets WHERE board_id=? AND page_id=? AND id=? AND
            (scope='public' OR (scope='private' AND draft_hash=? AND round_id=?))""",
            who.boardId, pageId, id, DraftCapabilities.hash(who, roundId), roundId,
        ) { it.next() }

    fun asset(connection: Connection, boardId: UUID, pageId: UUID, id: String): JsonNode? =
        connection.query("SELECT body FROM assets WHERE board_id=? AND page_id=? AND id=?", boardId, pageId, id) {
            if (it.next()) json.readTree(it.getString(1)) else null
        }

    fun assetIdExists(connection: Connection, boardId: UUID, id: String): Boolean =
        connection.query("SELECT 1 FROM assets WHERE board_id=? AND id=?", boardId, id) { it.next() }

    fun visibleElements(connection: Connection, who: Participant, state: BoardState): List<StoredElement> =
        connection.query(
            """SELECT id,body,scope,poker_created FROM elements WHERE board_id=? AND page_id=? AND
            (scope='public' OR (scope='private' AND draft_hash=? AND round_id=?))
            ORDER BY body->>'index' COLLATE "C" NULLS LAST,id""",
            who.boardId, state.pageId, DraftCapabilities.hash(who, state.roundId), state.roundId,
        ) { rows -> buildList {
            while (rows.next()) add(StoredElement(
                rows.getString(1), json.readTree(rows.getString(2)), rows.getString(3), rows.getBoolean(4),
            ))
        } }

    fun save(
        connection: Connection,
        table: SceneTable,
        who: Participant,
        id: String,
        body: JsonNode,
        scope: String,
        roundId: UUID?,
        pageId: UUID,
    ) {
        connection
            .prepareStatement(
            """INSERT INTO $table(board_id,id,body,scope,draft_hash,round_id,stored_bytes,page_id) VALUES(?,?,?::jsonb,?,?,?,?,?)
            ON CONFLICT(board_id,id) DO UPDATE SET body=EXCLUDED.body,stored_bytes=EXCLUDED.stored_bytes"""
            )
            .use {
                it.setObject(1, who.boardId)
                it.setString(2, id)
                it.setString(3, body.toString())
                it.setString(4, scope)
                it.setString(5, if (scope == "private") DraftCapabilities.hash(who, roundId) else null)
                it.setObject(6, roundId)
                it.setLong(7, body.toString().toByteArray(Charsets.UTF_8).size.toLong())
                it.setObject(8, pageId)
                it.executeUpdate()
            }
    }
    fun publicPageElements(connection: Connection, boardId: UUID, pageId: UUID): List<StoredElement> =
        connection.query(
            "SELECT id,body,poker_created FROM elements WHERE board_id=? AND page_id=? AND scope='public' AND NOT COALESCE((body->>'isDeleted')::boolean,false) ORDER BY id",
            boardId, pageId,
        ) { rows -> buildList {
            while (rows.next()) add(StoredElement(rows.getString(1), json.readTree(rows.getString(2)), "public", rows.getBoolean(3)))
        } }

    fun publicAssets(connection: Connection, boardId: UUID, pageId: UUID, ids: Set<String>): Map<String, JsonNode> {
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

    fun insertCopy(
        connection: Connection,
        table: SceneTable,
        who: Participant,
        pageId: UUID,
        id: String,
        body: JsonNode,
        pokerCreated: Boolean,
    ) {
        val pokerColumn = if (table == SceneTable.ELEMENTS) ",poker_created" else ""
        val pokerValue = if (table == SceneTable.ELEMENTS) ",?" else ""
        connection.prepareStatement(
            "INSERT INTO $table(board_id,id,body,scope,stored_bytes,page_id$pokerColumn) VALUES(?,?,?::jsonb,'public',?,?$pokerValue)",
        ).use {
            it.setObject(1, who.boardId)
            it.setString(2, id)
            it.setString(3, body.toString())
            it.setLong(4, body.toString().toByteArray(Charsets.UTF_8).size.toLong())
            it.setObject(5, pageId)
            if (table == SceneTable.ELEMENTS) it.setBoolean(6, pokerCreated)
            it.executeUpdate()
        }
    }

}
