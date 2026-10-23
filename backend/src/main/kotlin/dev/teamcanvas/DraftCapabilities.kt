package dev.teamcanvas

import java.sql.Connection
import java.util.UUID

/** Capability identities are round-scoped and have no stored relation to application accounts. */
object DraftCapabilities {
    fun hash(who: Participant, roundId: UUID?): String? {
        val key = who.draftKey ?: return null
        if (!Regex("^[A-Za-z0-9_-]{43}$").matches(key))
            throw ClientException("bad_request", "Invalid draft capability.")
        return roundId?.let { Security.hash("$it:$key") }
    }

    fun register(c: Connection, who: Participant, roundId: UUID): String {
        val hash = hash(who, roundId) ?: throw ClientException("locked", "Reconnect to recover your private draft.")
        val exists = c.query("SELECT 1 FROM private_drafts WHERE board_id=? AND round_id=? AND draft_hash=?", who.boardId, roundId, hash) { it.next() }
        if (!exists) {
            val count = c.query("SELECT count(*) FROM private_drafts WHERE board_id=? AND round_id=?", who.boardId, roundId) { it.next(); it.getInt(1) }
            if (count >= 200) throw ClientException("limit", "Private draft limit reached. Stop poker before starting another round.")
            c.update("INSERT INTO private_drafts(board_id,round_id,draft_hash) VALUES(?,?,?)", who.boardId, roundId, hash)
        }
        return hash
    }
}
