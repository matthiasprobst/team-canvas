package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.util.Base64
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
            filter !in setOf("all", "mine", "shared") ||
                sort !in setOf("recent", "name") ||
                limit !in 1..100 ||
                query.length > 120
        )
            throw ClientException("bad_request", "Invalid canvas filters.")
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
                    else -> ""
                }
            val values =
                mutableListOf<Any?>(
                    user.id,
                    "%" +
                        query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") +
                        "%",
                )
            val page =
                if (after != null) {
                    values.add(after.first)
                    values.add(after.second)
                    "AND ($key,b.id) $comparison (?${if (sort == "recent") "::numeric" else ""},?)"
                } else ""
            values.add(limit + 1)
            val rows =
                c.query(
                    """SELECT b.id,b.name,b.owner_user_id,u.display_name,b.created_at,p.last_opened_at,$key AS page_key
                FROM participants p JOIN boards b ON b.id=p.board_id JOIN app_users u ON u.id=b.owner_user_id
                WHERE p.user_id=? AND NOT p.revoked AND b.name ILIKE ? $relation $page
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
