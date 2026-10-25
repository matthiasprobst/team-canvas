package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.sql.Connection
import java.util.UUID

data class CanvasStorageUsage(val deletedElements: Long, val unusedImages: Long, val sceneBytes: Long, val imageBytes: Long, val poker: Boolean)

/** Compaction advances the epoch before publishing fresh snapshots, so stale tabs cannot resurrect deleted objects. */
@ApplicationScoped
class CanvasStorage @Inject constructor(private val repository: BoardRepository, private val accounts: Accounts, private val access: CanvasAccess) {
    private fun usage(c: Connection, id: UUID, poker: Boolean): CanvasStorageUsage = c.query(
        """SELECT
        (SELECT count(*) FROM elements WHERE board_id=? AND COALESCE((body->>'isDeleted')::boolean,false)),
        (SELECT count(*) FROM assets a WHERE a.board_id=? AND NOT EXISTS
          (SELECT 1 FROM elements e WHERE e.board_id=a.board_id AND e.page_id=a.page_id AND e.body->>'type'='image'
           AND e.body->>'fileId'=a.id AND NOT COALESCE((e.body->>'isDeleted')::boolean,false))),
        (SELECT coalesce(sum(stored_bytes),0) FROM elements WHERE board_id=?),
        (SELECT coalesce(sum(stored_bytes),0) FROM assets WHERE board_id=?)""", id, id, id, id,
    ) { it.next(); CanvasStorageUsage(it.getLong(1), it.getLong(2), it.getLong(3), it.getLong(4), poker) }

    fun inspect(id: UUID, identity: LoginIdentity): CanvasStorageUsage {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            val board = repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            if (board.mode == "poker") throw ClientException("locked", "Stop poker before inspecting or cleaning up storage.")
            usage(c, id, false)
        }
    }

    fun compact(id: UUID, identity: LoginIdentity): CanvasStorageUsage {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            val board = repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            if (board.mode == "poker") throw ClientException("locked", "Stop poker before cleaning up storage.")
            val removed = c.update("DELETE FROM elements WHERE board_id=? AND COALESCE((body->>'isDeleted')::boolean,false)", id)
            val images = c.update("""DELETE FROM assets a WHERE a.board_id=? AND NOT EXISTS
                (SELECT 1 FROM elements e WHERE e.board_id=a.board_id AND e.page_id=a.page_id
                AND e.body->>'type'='image' AND e.body->>'fileId'=a.id AND NOT COALESCE((e.body->>'isDeleted')::boolean,false))""", id)
            if (removed + images > 0) {
                c.update("UPDATE boards SET epoch=epoch+1,revision=revision+1 WHERE id=?", id)
                recordAccess(c, id, user.id, "storage_cleaned")
            }
            usage(c, id, false)
        }
    }
}
