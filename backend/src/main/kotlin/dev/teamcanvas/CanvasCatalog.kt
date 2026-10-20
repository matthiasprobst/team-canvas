package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.util.Base64
import java.util.Locale
import java.util.UUID

@ApplicationScoped
class CanvasCatalog
@Inject
constructor(
    private val repository: BoardRepository,
    private val accounts: Accounts,
    private val access: CanvasAccess,
) {
    fun list(
        identity: LoginIdentity,
        filter: String,
        query: String,
        sort: String,
        limit: Int,
        cursor: String?,
    ): CanvasPage {
        if (
            filter !in setOf("all", "mine", "shared", "templates") ||
                sort !in setOf("recent", "name") ||
                limit !in 1..100 ||
                query.length > 120
        )
            throw ClientException("bad_request", "Invalid canvas filters.")
        val search = "%" + query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        val user = accounts.current(identity)
        // A cursor is bound to the account and filters; it never grants access.
        val scope = Security.hash("${user.id}:$filter:$query:$sort")
        val after =
            cursor?.let {
                try {
                    require(it.length <= 2048)
                    val parts = String(Base64.getUrlDecoder().decode(it)).split('\n')
                    require(parts.size == 3 && parts[0] == scope)
                    if (sort == "recent")
                        require(
                            parts[1].toBigDecimal().abs() < java.math.BigDecimal("100000000000")
                        )
                    parts[1] to UUID.fromString(parts[2])
                } catch (_: Exception) {
                    throw ClientException("bad_request", "Invalid page cursor.")
                }
            }
        return repository.transaction { c ->
            accounts.requireLogin(c, user.id, identity.sid)
            val key =
                if (sort == "name") "lower(b.name)"
                else "extract(epoch from coalesce(p.last_opened_at,b.created_at))"
            val comparison = if (sort == "name") ">" else "<"
            val direction = if (sort == "name") "ASC" else "DESC"
            val relation =
                when (filter) {
                    "mine" -> "AND b.owner_user_id=p.user_id"
                    "shared" -> "AND b.owner_user_id<>p.user_id"
                    "templates" -> "AND (b.template_visibility='public' OR (b.owner_user_id=? AND b.template_visibility='private'))"
                    else -> "AND p.user_id IS NOT NULL"
                }
            val values =
                mutableListOf<Any?>(
                    user.id,
                    search,
                    search,
                )
            if (filter == "templates") values.add(user.id)
            val page =
                if (after != null) {
                    values.add(after.first)
                    values.add(after.second)
                    "AND ($key,b.id) $comparison (?${if (sort == "recent") "::numeric" else ""},?)"
                } else ""
            values.add(limit + 1)
            val rows =
                c.query(
                    """SELECT b.id,b.name,b.owner_user_id,u.display_name,b.created_at,p.last_opened_at,$key AS page_key,b.template_visibility,
                COALESCE((SELECT array_agg(t.tag ORDER BY lower(t.tag),t.tag) FROM canvas_tags t WHERE t.board_id=b.id),ARRAY[]::text[]) AS tags
                FROM boards b JOIN app_users u ON u.id=b.owner_user_id
                LEFT JOIN participants p ON p.board_id=b.id AND p.user_id=? AND NOT p.revoked
                WHERE (b.name ILIKE ? OR EXISTS (SELECT 1 FROM canvas_tags bt WHERE bt.board_id=b.id AND bt.tag ILIKE ?)) $relation $page
                ORDER BY $key $direction,b.id $direction LIMIT ?""",
                    *values.toTypedArray(),
                ) { r ->
                    buildList {
                        while (r.next()) {
                            val ownerId = r.getObject(3, UUID::class.java)
                            add(
                                CanvasSummary(
                                    r.getObject(1, UUID::class.java),
                                    r.getString(2),
                                    OwnerSummary(ownerId, r.getString(4)),
                                    if (ownerId == user.id) "owner" else "member",
                                    r.getTimestamp(5).toInstant().toString(),
                                    r.getTimestamp(6)?.toInstant()?.toString(),
                                    r.getString(8).takeIf { ownerId == user.id || filter == "templates" },
                                    (r.getArray(9).array as Array<*>).map { it as String },
                                ) to r.getString(7)
                            )
                        }
                    }
                }
            val items = rows.take(limit)
            val next =
                if (rows.size > limit)
                    items.last().let {
                        Base64.getUrlEncoder()
                            .withoutPadding()
                            .encodeToString("$scope\n${it.second}\n${it.first.id}".toByteArray())
                    }
                else null
            CanvasPage(items.map { it.first }, next)
        }
    }

    fun tagSuggestions(identity: LoginIdentity): List<String> {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            accounts.requireLogin(c, user.id, identity.sid)
            c.query(
                """SELECT t.tag FROM canvas_tags t JOIN boards b ON b.id=t.board_id
                WHERE b.owner_user_id=? GROUP BY t.tag ORDER BY lower(t.tag),t.tag LIMIT 200""",
                user.id,
            ) { rows -> buildList { while (rows.next()) add(rows.getString(1)) } }
        }
    }

    fun setTags(id: UUID, tags: List<String>, identity: LoginIdentity) {
        if (tags.size > 20) throw ClientException("bad_request", "A canvas can have at most 20 tags.")
        val normalized = tags.map { raw ->
            val tag = raw.trim()
            if (tag.isEmpty() || tag.length > 40 || tag.any(Char::isISOControl))
                throw ClientException("bad_request", "Each tag must contain 1 to 40 visible characters.")
            tag to tag.lowercase(Locale.ROOT)
        }
        if (normalized.map { it.second }.toSet().size != normalized.size)
            throw ClientException("bad_request", "Tags must be unique, ignoring capitalization.")
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            c.update("DELETE FROM canvas_tags WHERE board_id=?", id)
            normalized.forEach { (tag, key) ->
                c.update("INSERT INTO canvas_tags(board_id,tag,normalized_tag) VALUES(?,?,?)", id, tag, key)
            }
        }
    }

    fun markTemplate(id: UUID, visibility: String, identity: LoginIdentity) {
        if (visibility !in setOf("private", "public"))
            throw ClientException("bad_request", "Choose private or public template visibility.")
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            c.update("UPDATE boards SET template_visibility=? WHERE id=?", visibility, id)
        }
    }

    fun unmarkTemplate(id: UUID, identity: LoginIdentity) {
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            c.update("UPDATE boards SET template_visibility=NULL WHERE id=?", id)
        }
    }

    fun startTemplate(id: UUID, name: String, identity: LoginIdentity): CreatedBoard {
        val user = accounts.current(identity)
        return repository.transaction { c ->
            val source = repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            val visibility = c.query(
                "SELECT template_visibility FROM boards WHERE id=?",
                id,
            ) { rows ->
                if (rows.next()) rows.getString(1) else null
            }
            if (visibility == null || (visibility != "public" && sourceOwner(c, id) != user.id))
                throw ClientException("not_found", "Template not found or access is unavailable.")

            val title = canvasName(name)
            val copyId = UUID.randomUUID()
            val participantId = UUID.randomUUID()
            c.update("INSERT INTO boards(id,name,owner_user_id) VALUES(?,?,?)", copyId, title, user.id)
            c.update(
                "INSERT INTO participants(id,board_id,user_id,name,role) VALUES(?,?,?,?,'host')",
                participantId,
                copyId,
                user.id,
                user.displayName,
            )
            // Keep only shared canvas content. Reassign authorship to the new owner and leave
            // round IDs, members, invitations, sessions, and private poker work behind.
            c.update(
                """INSERT INTO elements(board_id,id,body,scope,author_id,round_id,stored_bytes,page_id,poker_created)
                SELECT ?,id,body,'public',?,NULL,stored_bytes,?,poker_created FROM elements
                WHERE board_id=? AND page_id=? AND scope='public'""",
                copyId,
                participantId,
                repository.board(c, copyId).pageId,
                id,
                source.pageId,
            )
            c.update(
                """INSERT INTO assets(board_id,id,body,scope,author_id,round_id,stored_bytes,page_id)
                SELECT ?, a.id, a.body, 'public', ?, NULL, a.stored_bytes,?
                FROM assets a
                WHERE a.board_id=? AND a.page_id=? AND a.scope='public'
                  AND EXISTS (
                    SELECT 1 FROM elements e
                    WHERE e.board_id=a.board_id AND e.page_id=a.page_id AND e.scope='public'
                      AND e.body->>'type'='image' AND e.body->>'fileId'=a.id
                      AND NOT COALESCE((e.body->>'isDeleted')::boolean, false)
                  )""",
                copyId,
                participantId,
                repository.board(c, copyId).pageId,
                id,
                source.pageId,
            )
            c.update(
                """INSERT INTO canvas_tags(board_id,tag,normalized_tag)
                SELECT ?,tag,normalized_tag FROM canvas_tags WHERE board_id=?""",
                copyId,
                id,
            )
            CreatedBoard(copyId, title)
        }
    }

    private fun sourceOwner(connection: java.sql.Connection, id: UUID): UUID? =
        connection.query("SELECT owner_user_id FROM boards WHERE id=?", id) {
            if (it.next()) it.getObject(1, UUID::class.java) else null
        }

    fun delete(id: UUID, identity: LoginIdentity) {
        val user = accounts.current(identity)
        repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            // Foreign keys cascade to content, rounds, memberships, sessions and invitations.
            c.update("DELETE FROM boards WHERE id=?", id)
        }
    }

    fun rename(id: UUID, name: String, identity: LoginIdentity): String {
        val title = canvasName(name)
        val user = accounts.current(identity)
        return repository.transaction { c ->
            repository.board(c, id)
            accounts.requireLogin(c, user.id, identity.sid)
            access.requireOwner(c, id, user)
            c.update("UPDATE boards SET name=? WHERE id=?", title, id)
            title
        }
    }
}
