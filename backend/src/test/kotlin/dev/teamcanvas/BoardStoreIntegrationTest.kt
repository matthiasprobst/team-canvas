package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.util.UUID
import java.util.concurrent.Executors
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.postgresql.ds.PGSimpleDataSource

/** Run against a disposable PostgreSQL database; every run uses and removes its own schema. */
@EnabledIfEnvironmentVariable(named = "TEAM_CANVAS_TEST_JDBC_URL", matches = ".+")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BoardStoreIntegrationTest {
    private val json = jacksonObjectMapper()
    private val schema = "test_" + UUID.randomUUID().toString().replace("-", "")
    private lateinit var dataSource: PGSimpleDataSource
    private lateinit var store: BoardStore
    private lateinit var access: CanvasAccess
    private lateinit var accounts: Accounts
    private lateinit var catalog: CanvasCatalog
    private lateinit var rounds: RoundService
    private lateinit var pages: CanvasPageService

    @BeforeAll
    fun setup() {
        dataSource =
            PGSimpleDataSource().apply {
                setURL(System.getenv("TEAM_CANVAS_TEST_JDBC_URL"))
                user = System.getenv("DB_USER") ?: "board"
                password = System.getenv("DB_PASSWORD") ?: "board-test"
                currentSchema = schema
            }
        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate()
        val repository = BoardRepository(dataSource)
        store = BoardStore(repository, SceneRepository(json), json)
        rounds = RoundService(repository)
        pages = CanvasPageService(repository, SceneRepository(json))
        accounts = Accounts(repository)
        access = CanvasAccess(repository, accounts)
        catalog = CanvasCatalog(repository, accounts, access)
    }

    @AfterAll
    fun cleanup() {
        if (::dataSource.isInitialized)
            dataSource.connection.use {
                it.createStatement().use { statement ->
                    statement.execute("DROP SCHEMA IF EXISTS $schema CASCADE")
                }
            }
    }

    @Test
    fun `a round can finish after start consumed the daily budget without allowing unlimited controls`() {
        val room = room()
        dataSource.connection.use { c ->
            c.update("""INSERT INTO command_receipts(board_id,receipt_scope,command_id,revision)
                SELECT ?,'public',gen_random_uuid(),n FROM generate_series(1,?) n""",
                room.board.id, BoardLimits.COMMANDS_PER_DAY - 1)
        }
        rounds.start(room.host, context(room.host))
        val stop = context(room.host)
        error("daily_limit") { store.patch(room.host, context(room.host), listOf(shape("over-budget")), emptyMap()) }
        assertTrue(rounds.stop(room.guest, stop).transitioned)
        assertTrue(rounds.stop(room.guest, stop).duplicate)
        error("daily_limit") { rounds.stop(room.host, stop.copy(commandId = UUID.randomUUID())) }
        error("daily_limit") { rounds.start(room.host, context(room.host)) }
        error("daily_limit") { pages.select(room.host, context(room.host), stop.pageId) }
        assertEquals("standard", store.snapshot(room.host).board.mode)
        dataSource.connection.use { c ->
            assertEquals(BoardLimits.COMMANDS_PER_DAY + 1, c.query(
                "SELECT count(*) FROM command_receipts WHERE board_id=?", room.board.id,
            ) { it.next(); it.getInt(1) })
        }
    }

    @Test
    fun `losing a live database advisory lock requires a fresh backend instance`() {
        val source = object : javax.sql.DataSource by dataSource {
            lateinit var held: java.sql.Connection
            override fun getConnection(): java.sql.Connection = dataSource.connection.also { held = it }
        }
        val writer = SingleWriterGuard(source)
        val replacement = SingleWriterGuard(dataSource)
        try {
            writer.start()
            assertTrue(writer.ownsDatabase())
            source.held.createStatement().use { it.execute("SELECT pg_advisory_unlock(1978842491)") }
            assertFalse(writer.ownsDatabase())
            replacement.start()
            assertTrue(replacement.ownsDatabase())
            assertFalse(writer.isAlive())
            assertThrows(IllegalStateException::class.java) { writer.start() }
        } finally {
            writer.close()
            replacement.close()
        }
    }

    @Test
    fun `storage cleanup releases deleted object capacity and rejects stale writes and unauthorized cleanup`() {
        val room = room()
        val repository = BoardRepository(dataSource)
        val storage = CanvasStorage(repository, accounts, access)
        val before = context(room.host)
        dataSource.connection.use { c ->
            c.prepareStatement("""INSERT INTO elements(board_id,id,page_id,body,scope,stored_bytes)
                SELECT ?, 'deleted-'||n, ?, jsonb_build_object('id','deleted-'||n,'type','rectangle','x',0,'y',0,'width',10,'height',10,'isDeleted',true),'public',100
                FROM generate_series(1,4000) n""").use {
                it.setObject(1, room.board.id); it.setObject(2, before.pageId); it.executeUpdate()
            }
            c.update("INSERT INTO assets(board_id,id,page_id,body,scope,stored_bytes) VALUES(?,'unused',?,'{}','public',100)", room.board.id, before.pageId)
        }
        assertEquals(4000L, storage.inspect(room.board.id, room.owner).deletedElements)
        error("not_found") { storage.compact(room.board.id, room.visitor) }
        error("limit") { store.patch(room.host, before, listOf(shape("new")), emptyMap()) }
        val cleaned = storage.compact(room.board.id, room.owner)
        assertEquals(0L, cleaned.deletedElements)
        assertEquals(0L, cleaned.unusedImages)
        assertEquals(0L, cleaned.imageBytes)
        error("stale_round") { store.patch(room.guest, before, listOf(shape("deleted-1")), emptyMap()) }
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        store.patch(room.host, context(room.host), listOf(shape("new")), emptyMap())
        assertEquals("new", store.snapshot(room.guest).elements.single().path("id").asText())
        rounds.start(room.host, context(room.host))
        error("locked") { storage.compact(room.board.id, room.owner) }
        error("locked") { storage.inspect(room.board.id, room.owner) }
    }

    @Test
    fun `membership labels reflect disabled accounts and access history is owner only`() {
        val room = room()
        val memberId = accounts.current(room.visitor).id
        dataSource.connection.use { it.update("UPDATE app_users SET status='deactivated' WHERE id=?", memberId) }
        assertEquals("deactivated", access.members(room.board.id, room.owner).items.single { it.id == room.guest.id }.accountStatus)
        access.setMemberAccess(room.board.id, room.guest.id, true, room.owner)
        access.setMemberAccess(room.board.id, room.guest.id, true, room.owner)
        access.setMemberAccess(room.board.id, room.guest.id, false, room.owner)
        val history = access.history(room.board.id, room.owner)
        assertEquals(listOf("member_restored", "member_removed"), history.map { it.action })
        assertEquals(memberId, history.first().targetId)
        val stranger = user()
        error("not_found") { access.history(room.board.id, stranger) }
    }

    @Test
    fun `public template publication is visible to owners and can be made private after member removal`() {
        val room = room()
        catalog.markTemplate(room.board.id, "public", room.owner)
        access.setMemberAccess(room.board.id, room.guest.id, true, room.owner)
        assertEquals("public", access.members(room.board.id, room.owner).templateVisibility)
        catalog.startTemplate(room.board.id, "Public copy", room.visitor)
        catalog.markTemplate(room.board.id, "private", room.owner)
        error("not_found") { catalog.startTemplate(room.board.id, "Blocked copy", room.visitor) }
        assertEquals("private", access.members(room.board.id, room.owner).templateVisibility)
    }

    @Test
    fun `unchanged accounts do not rewrite profiles and revoked logins cannot be reactivated`() {
        val identity = user().copy(username = "stable-user")
        val account = accounts.current(identity)
        fun version() = dataSource.connection.use { c -> c.query("SELECT xmin::text FROM app_users WHERE id=?", account.id) { it.next(); it.getString(1) } }
        val original = version()
        repeat(3) { assertEquals("stable-user", accounts.current(identity).username) }
        assertEquals(original, version())
        assertEquals("Updated", accounts.current(identity.copy(name = "Updated")).displayName)
        assertNotEquals(original, version())
        accounts.logout(identity)
        error("unauthorized") { accounts.current(identity) }
    }


    @Test
    fun `configured quotas reject concurrent ownership growth and excess pages without deleting data`() {
        val repository = BoardRepository(dataSource, CanvasLimits(2, 2))
        val limitedAccounts = Accounts(repository)
        val limitedAccess = CanvasAccess(repository, limitedAccounts)
        val owner = user()
        val pool = Executors.newFixedThreadPool(4)
        try {
            val attempts = (1..4).map { n -> pool.submit<Boolean> {
                try { limitedAccess.create("Quota $n", owner); true }
                catch (error: ClientException) { assertEquals("limit", error.code); false }
            } }
            assertEquals(2, attempts.count { it.get() })
        } finally { pool.shutdownNow() }
        val canvas = CanvasCatalog(repository, limitedAccounts, limitedAccess).list(owner, "mine", "", "recent", 10, null).items.first()
        val joined = limitedAccess.join(canvas.id, JoinRequest(), owner)
        val who = limitedAccess.authenticate(canvas.id, joined.token, owner)
        val limitedPages = CanvasPageService(repository, SceneRepository(json))
        limitedPages.create(who, context(who), false, false)
        error("limit") { limitedPages.create(who, context(who), false, false) }
        assertEquals(2, store.snapshot(who).pages.size)
        val lowered = BoardRepository(dataSource, CanvasLimits(1, 1))
        assertEquals(2, BoardStore(lowered, SceneRepository(json), json).snapshot(who).pages.size)
    }

    @Test
    fun `templates preserve every page and exclude hidden data with atomic quota failure`() {
        val room = room()
        val first = store.snapshot(room.host).board.pageId
        store.patch(room.host, context(room.host), listOf(shape("page-one")), emptyMap())
        pages.create(room.host, context(room.host), false, false)
        store.patch(room.host, context(room.host), listOf(shape("page-two")), emptyMap())
        pages.create(room.host, context(room.host), false, false)
        rounds.start(room.guest, context(room.guest))
        store.patch(room.guest, context(room.guest), listOf(shape("secret")), emptyMap())
        catalog.markTemplate(room.board.id, "public", room.owner)
        val starter = user()
        val copied = catalog.startTemplate(room.board.id, "Three pages", starter)
        val joined = access.join(copied.id, JoinRequest(), starter)
        val who = access.authenticate(copied.id, joined.token, starter)
        val snapshot = store.snapshot(who)
        assertEquals(3, snapshot.pages.size)
        assertEquals(0, snapshot.pages.first { it.id == snapshot.board.pageId }.position)
        assertNotEquals(first, snapshot.board.pageId)
        assertEquals(1, snapshot.elements.size)
        pages.select(who, context(who), snapshot.pages[1].id)
        assertEquals(1, store.snapshot(who).elements.size)
        pages.select(who, context(who), snapshot.pages[2].id)
        assertTrue(store.snapshot(who).elements.isEmpty())
        val repo = BoardRepository(dataSource, CanvasLimits(2, 20))
        val limited = CanvasCatalog(repo, Accounts(repo), CanvasAccess(repo, Accounts(repo)))
        val before = catalog.list(starter, "mine", "", "recent", 24, null).items.size
        error("limit") { limited.startTemplate(room.board.id, "Must roll back", starter) }
        assertEquals(before, catalog.list(starter, "mine", "", "recent", 24, null).items.size)
        catalog.unmarkTemplate(room.board.id, room.owner)
    }

    @Test
    fun `expired invitations reject both preview and acceptance without revoking membership`() {
        val room = room()
        dataSource.connection.use { c -> c.update("UPDATE board_invitations SET expires_at=now()-interval '1 second' WHERE board_id=?", room.board.id) }
        error("not_found") { access.preview(room.board.id, room.inviteKey, user()) }
        error("not_found") { access.join(room.board.id, JoinRequest(room.inviteKey), user()) }
        assertNotNull(access.authenticate(room.board.id, room.guestToken, room.visitor))
        repeat(20) { access.invite(room.board.id, room.owner) }
        error("limit") { access.invite(room.board.id, room.owner) }
    }

    private data class Room(
        val board: CreatedBoard,
        val host: Participant,
        val guest: Participant,
        val guestToken: String,
        val owner: LoginIdentity,
        val visitor: LoginIdentity,
        val inviteKey: String,
    )

    private fun user(name: String = "User") =
        LoginIdentity(
            "https://identity.test/realm",
            UUID.randomUUID().toString(),
            UUID.randomUUID().toString(),
            name,
        )

    private fun room(): Room {
        val owner = user("Host")
        val visitor = user("Guest")
        val board = access.create("Integration", owner)
        val key = access.invite(board.id, owner).getValue("inviteKey")
        val host = access.join(board.id, JoinRequest(), owner)
        val guest = access.join(board.id, JoinRequest(key), visitor)
        return Room(
            board,
            access.authenticate(board.id, host.token, owner).copy(draftKey = Security.token()),
            access.authenticate(board.id, guest.token, visitor).copy(draftKey = Security.token()),
            guest.token,
            owner,
            visitor,
            key,
        )
    }

    private fun context(who: Participant): CommandContext {
        val board = store.snapshot(who).board
        return CommandContext(UUID.randomUUID(), board.epoch, board.roundId, board.pageId)
    }

    private fun shape(id: String, x: Int = 0) =
        json.readTree("""{"id":"$id","type":"rectangle","x":$x,"y":0,"width":10,"height":10}""")

    private fun error(code: String, action: () -> Unit) {
        assertEquals(code, assertThrows(ClientException::class.java, action).code)
    }

    @Test
    fun `pages copy independent drawings and images while selection enforces current context`() {
        val room = room()
        val first = store.snapshot(room.host).board.pageId
        val image = json.readTree(
            """{"id":"file","mimeType":"image/png","created":1,"dataURL":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="}"""
        )
        val drawing = (shape("image") as com.fasterxml.jackson.databind.node.ObjectNode).put("type", "image").put("fileId", "file")
        store.patch(room.host, context(room.host), listOf(shape("original"), drawing), mapOf("file" to image))
        val old = context(room.host)
        val created = pages.create(room.guest, context(room.guest), true, false)
        assertTrue(created.transitioned)
        val copied = store.snapshot(room.host)
        assertEquals(2, copied.pages.size)
        assertEquals(copied.board.pageId, store.snapshot(room.guest).board.pageId)
        assertNotEquals(first, copied.board.pageId)
        assertEquals(2, copied.elements.size)
        assertTrue(copied.elements.none { it.path("id").asText() in setOf("original", "image") })
        val copiedFile = copied.fileIds.single()
        assertNotEquals("file", copiedFile)
        assertEquals(copiedFile, store.asset(room.guest, copiedFile).path("id").asText())
        error("stale_round") { store.patch(room.host, old, listOf(shape("stale")), emptyMap()) }
        error("not_found") { pages.select(room.host, context(room.host), UUID.randomUUID()) }
        val selection = context(room.host)
        val selected = pages.select(room.host, selection, first)
        assertTrue(selected.transitioned)
        assertTrue(pages.select(room.host, selection, first).duplicate)
        assertEquals(setOf("original", "image"), store.snapshot(room.host).elements.map { it.path("id").asText() }.toSet())
        val noOp = context(room.host)
        val unchanged = pages.select(room.host, noOp, first)
        assertFalse(unchanged.transitioned)
        assertEquals(unchanged.ack, pages.select(room.host, noOp, first).ack)
        val blank = context(room.host)
        pages.create(room.host, blank, false, false)
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        assertTrue(pages.create(room.host, blank, false, false).duplicate)
        assertEquals(3, store.snapshot(room.host).pages.size)
    }

    @Test
    fun `page changes are locked during poker and copies can omit published poker drawings`() {
        val room = room()
        store.patch(room.host, context(room.host), listOf(shape("public")), emptyMap())
        val first = store.snapshot(room.host).board.pageId
        rounds.start(room.host, context(room.host))
        error("poker_active") { pages.create(room.host, context(room.host), false, false) }
        error("poker_active") { pages.select(room.guest, context(room.guest), first) }
        val patch = store.patch(room.guest, context(room.guest), listOf(shape("poker")), emptyMap())
        rounds.stop(room.guest, context(room.guest))
        assertEquals(listOf("poker"), store.snapshot(room.host).pokerCreatedIds)
        pages.create(room.host, context(room.host), true, false)
        assertEquals(1, store.snapshot(room.host).elements.size)
        assertTrue(store.snapshot(room.host).pokerCreatedIds.isEmpty())
        pages.select(room.host, context(room.host), first)
        pages.create(room.host, context(room.host), true, true)
        assertEquals(2, store.snapshot(room.host).elements.size)
        assertEquals(1, store.snapshot(room.host).pokerCreatedIds.size)
        access.revoke(room.board.id, room.owner, true)
        error("unauthorized") { pages.create(room.guest, context(room.host), false, false) }
    }

    @Test
    fun `only the owner can delete a canvas and all related data is removed`() {
        val room = room()
        val other = access.create("Keep this canvas", room.owner)
        error("not_found") { catalog.delete(room.board.id, room.visitor) }
        error("not_found") { catalog.delete(room.board.id, user("Outsider")) }
        rounds.start(room.host, context(room.host))
        val image = json.readTree(
            """{"id":"file","mimeType":"image/png","created":1,"dataURL":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="}"""
        )
        val element = (shape("image") as com.fasterxml.jackson.databind.node.ObjectNode)
            .put("type", "image").put("fileId", "file")
        store.patch(room.guest, context(room.guest), listOf(element), mapOf("file" to image))
        val roundId = store.snapshot(room.host).board.roundId
        catalog.delete(room.board.id, room.owner)
        dataSource.connection.use { c ->
            for (table in listOf("boards", "participants", "rounds", "elements", "assets", "board_invitations")) {
                val column = if (table == "boards") "id" else "board_id"
                assertEquals(0L, c.query("SELECT count(*) FROM $table WHERE $column=?", room.board.id) {
                    it.next(); it.getLong(1)
                }, table)
            }
            for (table in listOf("board_sessions")) {
                assertEquals(0L, c.query("SELECT count(*) FROM $table WHERE participant_id IN (?,?)", room.host.id, room.guest.id) {
                    it.next(); it.getLong(1)
                }, table)
            }
        }
        assertEquals(listOf(other.id), catalog.list(room.owner, "all", "", "recent", 24, null).items.map { it.id })
        assertTrue(catalog.list(room.visitor, "all", "", "recent", 24, null).items.isEmpty())
        error("unauthorized") { access.authenticate(room.board.id, room.guestToken, room.visitor) }
        error("not_found") { access.join(room.board.id, JoinRequest(room.inviteKey), room.visitor) }
        error("not_found") { access.preview(room.board.id, room.inviteKey, room.visitor) }
        error("not_found") { catalog.delete(room.board.id, room.owner) }
        accounts.logout(room.owner)
        error("unauthorized") { catalog.delete(other.id, room.owner) }
    }

    @Test
    fun `private and public templates create independent canvases with shared content only`() {
        val room = room()
        catalog.setTags(room.board.id, listOf("planning", " Q3 roadmap "), room.owner)
        val publicImage = json.readTree(
            """{"id":"public-file","mimeType":"image/png","created":1,"dataURL":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="}"""
        )
        val publicImageElement = (shape("public-image") as com.fasterxml.jackson.databind.node.ObjectNode)
            .put("type", "image").put("fileId", "public-file")
        store.patch(room.host, context(room.host), listOf(shape("shared-shape"), publicImageElement), mapOf("public-file" to publicImage))

        rounds.start(room.host, context(room.host))
        val privateImage = publicImage.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>()
            .put("id", "private-file")
        val privateImageElement = (shape("private-image") as com.fasterxml.jackson.databind.node.ObjectNode)
            .put("type", "image").put("fileId", "private-file")
        store.patch(room.guest, context(room.guest), listOf(shape("private-shape"), privateImageElement), mapOf("private-file" to privateImage))

        error("not_found") { catalog.startTemplate(room.board.id, "Unauthorized copy", room.visitor) }
        error("not_found") { catalog.markTemplate(room.board.id, "public", room.visitor) }
        catalog.markTemplate(room.board.id, "private", room.owner)
        assertEquals("private", catalog.list(room.owner, "templates", "", "recent", 24, null).items.single().templateVisibility)
        assertTrue(catalog.list(room.visitor, "templates", "", "recent", 24, null).items.isEmpty())
        assertNull(catalog.list(room.visitor, "shared", "", "recent", 24, null).items.single().templateVisibility)
        val privateCopy = catalog.startTemplate(room.board.id, "Private working copy", room.owner)
        assertEquals("Private working copy", privateCopy.name)
        assertNotEquals(room.board.id, privateCopy.id)
        error("not_found") { catalog.startTemplate(room.board.id, "Unauthorized copy", room.visitor) }

        catalog.markTemplate(room.board.id, "public", room.owner)
        val publicTemplates = catalog.list(room.visitor, "templates", "", "recent", 24, null).items
        assertEquals(listOf(room.board.id), publicTemplates.map { it.id })
        assertEquals("public", publicTemplates.single().templateVisibility)

        val starter = user("Starter")
        assertEquals(listOf(room.board.id), catalog.list(starter, "templates", "", "recent", 24, null).items.map { it.id })
        val copy = catalog.startTemplate(room.board.id, "Planning session", starter)
        assertEquals("Planning session", copy.name)
        assertNotEquals(room.board.id, copy.id)
        assertEquals(listOf("planning", "Q3 roadmap"), catalog.list(starter, "mine", "ROADMAP", "recent", 24, null).items.single().tags)
        assertEquals(listOf("planning", "Q3 roadmap"), catalog.list(starter, "mine", "planning", "recent", 24, null).items.single().tags)
        assertEquals(listOf("planning", "Q3 roadmap"), catalog.tagSuggestions(room.owner))
        assertEquals(listOf("planning", "Q3 roadmap"), catalog.tagSuggestions(starter))
        val joined = access.join(copy.id, JoinRequest(), starter)
        assertEquals("host", joined.role)
        val copiedParticipant = access.authenticate(copy.id, joined.token, starter)
        val copiedScene = store.snapshot(copiedParticipant)
        assertEquals("standard", copiedScene.board.mode)
        assertNull(copiedScene.round)
        assertEquals(2, copiedScene.elements.size)
        assertTrue(copiedScene.elements.none { it.path("id").asText() in setOf("shared-shape", "public-image") })
        assertEquals(1, copiedScene.fileIds.size)
        assertNotEquals("public-file", copiedScene.fileIds.single())
        assertTrue(catalog.list(starter, "mine", "", "recent", 24, null).items.any { it.id == copy.id && it.templateVisibility == null })

        store.patch(copiedParticipant, context(copiedParticipant), listOf(shape("copy-only")), emptyMap())
        assertTrue(store.snapshot(room.host).elements.none { it.path("id").asText() == "copy-only" })
        assertTrue(store.snapshot(room.guest).elements.any { it.path("id").asText() == "private-shape" })
        assertTrue(store.snapshot(room.guest).fileIds.contains("private-file"))

        catalog.unmarkTemplate(room.board.id, room.owner)
        assertTrue(catalog.list(starter, "templates", "", "recent", 24, null).items.isEmpty())
        error("not_found") { catalog.startTemplate(room.board.id, "Unauthorized copy", starter) }
    }

    @Test
    fun `canvas tags are owner managed searchable shared and normalized`() {
        val room = room()
        val other = access.create("Quarterly planning", room.owner)
        catalog.setTags(room.board.id, listOf("  Planning ", "Design"), room.owner)

        assertEquals(listOf("Design", "Planning"), catalog.list(room.owner, "mine", "design", "recent", 24, null).items.single().tags)
        assertEquals(listOf(room.board.id), catalog.list(room.visitor, "shared", "design", "recent", 24, null).items.map { it.id })
        assertEquals(listOf(other.id), catalog.list(room.owner, "mine", "quarterly", "recent", 24, null).items.map { it.id })
        assertEquals(listOf("Design", "Planning"), catalog.tagSuggestions(room.owner))

        error("not_found") { catalog.setTags(room.board.id, listOf("intruder"), room.visitor) }
        error("bad_request") { catalog.setTags(room.board.id, listOf("Planning", "planning"), room.owner) }
        error("bad_request") { catalog.setTags(room.board.id, List(21) { "tag$it" }, room.owner) }
        error("bad_request") { catalog.setTags(room.board.id, listOf(""), room.owner) }
        catalog.setTags(room.board.id, emptyList(), room.owner)
        assertTrue(catalog.list(room.owner, "mine", "design", "recent", 24, null).items.isEmpty())
        assertEquals(listOf(other.id), catalog.list(room.owner, "mine", "quarterly", "recent", 24, null).items.map { it.id })
    }

    @Test
    fun `private drafts require a capability and any member can reveal saved offline work`() {
        val room = room()
        store.patch(room.host, context(room.host), listOf(shape("base")), emptyMap())
        rounds.start(room.guest, context(room.guest))
        val old = context(room.guest)
        store.patch(room.guest, old, listOf(shape("private")), emptyMap())
        assertEquals(listOf("base"), store.snapshot(room.host).elements.map { it.path("id").asText() })
        assertEquals(2, store.snapshot(room.guest).elements.size)
        val missing = room.guest.copy(draftKey = null)
        val wrong = room.guest.copy(draftKey = Security.token())
        assertEquals(1, store.snapshot(missing).elements.size)
        assertEquals(1, store.snapshot(wrong).elements.size)
        error("locked") { store.patch(missing, context(missing), listOf(shape("attack")), emptyMap()) }
        error("forbidden") { store.patch(wrong, context(wrong), listOf(shape("private", 99)), emptyMap()) }
        error("forbidden") { store.patch(room.guest, context(room.guest), listOf(shape("base", 99)), emptyMap()) }
        assertTrue(rounds.stop(room.host, context(room.host)).transitioned)
        assertEquals(2, store.snapshot(room.host).elements.size)
        error("stale_round") { store.patch(room.guest, old.copy(commandId=UUID.randomUUID()), listOf(shape("late")), emptyMap()) }
        dataSource.connection.use { c ->
            assertEquals(0L, c.query("SELECT count(*) FROM private_drafts WHERE board_id=?", room.board.id) { it.next(); it.getLong(1) })
            assertEquals(0L, c.query("SELECT count(*) FROM elements WHERE board_id=? AND draft_hash IS NOT NULL", room.board.id) { it.next(); it.getLong(1) })
            assertEquals(0L, c.query("SELECT count(*) FROM information_schema.columns WHERE table_schema=? AND table_name IN ('elements','assets','command_receipts','canvas_pages') AND column_name IN ('author_id','participant_id','created_by')", schema) { it.next(); it.getLong(1) })
        }
    }

    @Test
    fun `drawing receipts have no account mapping and commands apply once`() {
        val room = room()
        val command = context(room.host)
        val first = store.patch(room.host, command, listOf(shape("public")), emptyMap())
        val retry = store.patch(room.host, command, listOf(shape("public", 99)), emptyMap())
        assertTrue(retry.result.duplicate)
        assertEquals(first.result.ack, retry.result.ack)
        assertEquals(0, store.snapshot(room.host).elements.single().path("x").asInt())
        rounds.start(room.guest, context(room.guest))
        access.revoke(room.board.id, room.owner, true)
        error("unauthorized") { rounds.stop(room.guest, context(room.host)) }
    }

    @Test
    fun `late arrivals can contribute and reveal without owner participation`() {
        val room = room()
        rounds.start(room.guest, context(room.guest))
        val identity = user("Late")
        val joined = access.join(room.board.id, JoinRequest(room.inviteKey), identity)
        val late = access.authenticate(room.board.id, joined.token, identity).copy(draftKey = Security.token())
        store.patch(late, context(late), listOf(shape("late")), emptyMap())
        assertTrue(store.snapshot(room.guest).elements.isEmpty())
        rounds.stop(late, context(late))
        assertEquals(1, store.snapshot(room.guest).elements.size)
    }

    @Test
    fun `simultaneous stop commands reveal exactly once`() {
        val room = room()
        rounds.start(room.guest, context(room.guest))
        val host = context(room.host)
        val guest = context(room.guest)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val a = executor.submit<CommandResult> { rounds.stop(room.host, host) }
            val b = executor.submit<CommandResult> { rounds.stop(room.guest, guest) }
            assertEquals(1, listOf(a.get(), b.get()).count { it.transitioned })
            assertEquals("standard", store.snapshot(room.host).board.mode)
            assertTrue(rounds.stop(room.host, host).duplicate)
        } finally { executor.shutdownNow() }
    }

    @Test
    fun `updates and deletions still work at the element quota`() {
        val room = room()
        for (batch in 0 until 40) store.patch(
            room.host,
            context(room.host),
            (0 until 100).map { shape("el_${batch * 100 + it}") },
            emptyMap(),
        )
        store.patch(room.host, context(room.host), listOf(shape("el_0", 9)), emptyMap())
        val deleted =
            (shape("el_1") as com.fasterxml.jackson.databind.node.ObjectNode).put("isDeleted", true)
        store.patch(room.host, context(room.host), listOf(deleted), emptyMap())
        assertEquals(
            9,
            store
                .snapshot(room.host)
                .elements
                .first { it.path("id").asText() == "el_0" }
                .path("x")
                .asInt(),
        )
        error("limit") {
            store.patch(room.host, context(room.host), listOf(shape("overflow")), emptyMap())
        }
    }

    @Test
    fun `invitations bind sessions to issuer subject and login while durable membership survives logout`() {
        val room = room()
        val outsider = user()
        error("not_found") { access.join(room.board.id, JoinRequest(), outsider) }
        error("unauthorized") { access.authenticate(room.board.id, room.guestToken, room.owner) }
        error("unauthorized") {
            access.authenticate(
                room.board.id,
                room.guestToken,
                room.visitor.copy(issuer = "https://other.test"),
            )
        }
        val secondLogin = room.visitor.copy(sid = UUID.randomUUID().toString())
        val second = access.join(room.board.id, JoinRequest(), secondLogin)
        assertEquals(room.guest.id, second.participantId)
        accounts.logout(room.visitor)
        error("unauthorized") { access.authenticate(room.board.id, room.guestToken, room.visitor) }
        error("unauthorized") { accounts.current(room.visitor) }
        assertEquals(
            room.guest.id,
            access.authenticate(room.board.id, second.token, secondLogin).id,
        )
        assertEquals(
            room.board.id,
            catalog.list(secondLogin, "shared", "", "recent", 24, null).items.single().id,
        )
        error("not_found") { access.invite(room.board.id, outsider) }
        error("not_found") { catalog.rename(room.board.id, "Attack", outsider) }
        access.revoke(room.board.id, room.owner, true)
        error("unauthorized") { access.authenticate(room.board.id, second.token, secondLogin) }
        error("not_found") { access.join(room.board.id, JoinRequest(room.inviteKey), outsider) }
        val newKey = access.invite(room.board.id, room.owner).getValue("inviteKey")
        error("not_found") { access.join(room.board.id, JoinRequest(newKey), secondLogin) }
        access.setMemberAccess(room.board.id, room.guest.id, false, room.owner)
        assertEquals(
            room.guest.id,
            access.join(room.board.id, JoinRequest(newKey), secondLogin).participantId,
        )
    }

    @Test
    fun `multiple tabs and invitations preserve stable memberships and poker drafts`() {
        val room = room()
        val anotherKey = access.invite(room.board.id, room.owner).getValue("inviteKey")
        assertNotNull(access.preview(room.board.id, room.inviteKey, room.visitor))
        assertNotNull(access.preview(room.board.id, anotherKey, room.visitor))
        rounds.start(room.host, context(room.host))
        store.patch(room.guest, context(room.guest), listOf(shape("private")), emptyMap())
        val tab = access.join(room.board.id, JoinRequest(), room.visitor)
        assertEquals(room.guest.id, tab.participantId)
        assertNotEquals(room.guestToken, tab.token)
        assertEquals(
            1,
            store
                .snapshot(access.authenticate(room.board.id, tab.token, room.visitor).copy(draftKey = room.guest.draftKey))
                .elements
                .size,
        )
        assertTrue(store.snapshot(access.authenticate(room.board.id, tab.token, room.visitor)).elements.isEmpty())
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        access.revoke(room.board.id, room.owner, false)
        assertNotNull(access.authenticate(room.board.id, tab.token, room.visitor))
        error("not_found") { access.preview(room.board.id, anotherKey, room.visitor) }
    }

    @Test
    fun `only the owner can list and manage members of the specified canvas`() {
        val room = room()
        access.join(room.board.id, JoinRequest(), room.visitor)
        val members = access.members(room.board.id, room.owner).items
        assertEquals(2, members.size)
        assertEquals("owner", members.first().role)
        assertEquals(room.host.id, members.first().id)
        assertEquals("member", members.last().role)
        assertEquals(room.guest.id, members.last().id)
        assertFalse(members.last().revoked)
        for (actor in listOf(room.visitor, user("Outsider"))) {
            error("not_found") { access.members(room.board.id, actor) }
            error("not_found") { access.setMemberAccess(room.board.id, room.guest.id, true, actor) }
            error("not_found") { access.setMemberAccess(room.board.id, room.guest.id, false, actor) }
        }
        for (revoked in listOf(true, false)) {
            error("bad_request") { access.setMemberAccess(room.board.id, room.host.id, revoked, room.owner) }
        }
        val another = room()
        error("not_found") { access.setMemberAccess(room.board.id, another.guest.id, true, room.owner) }
        error("not_found") { access.setMemberAccess(room.board.id, UUID.randomUUID(), false, room.owner) }
        assertNotNull(access.authenticate(another.board.id, another.guestToken, another.visitor))
    }

    @Test
    fun `individual removal revokes every session and restoration never revives old tokens`() {
        val room = room()
        val tabLogin = room.visitor.copy(sid = UUID.randomUUID().toString())
        val tab = access.join(room.board.id, JoinRequest(), tabLogin)
        val colleague = user("Colleague")
        val colleagueSession = access.join(room.board.id, JoinRequest(room.inviteKey), colleague)
        val other = access.create("Unaffected canvas", room.visitor)
        val otherSession = access.join(other.id, JoinRequest(), room.visitor)
        repeat(2) { access.setMemberAccess(room.board.id, room.guest.id, true, room.owner) }
        assertTrue(access.members(room.board.id, room.owner).items.single { it.id == room.guest.id }.revoked)
        error("unauthorized") { access.authenticate(room.board.id, room.guestToken, room.visitor) }
        error("unauthorized") { access.authenticate(room.board.id, tab.token, tabLogin) }
        error("not_found") { access.join(room.board.id, JoinRequest(), room.visitor) }
        error("not_found") { access.join(room.board.id, JoinRequest(room.inviteKey), room.visitor) }
        val freshKey = access.invite(room.board.id, room.owner).getValue("inviteKey")
        error("not_found") { access.join(room.board.id, JoinRequest(freshKey), room.visitor) }
        assertTrue(catalog.list(room.visitor, "shared", "", "recent", 24, null).items.none { it.id == room.board.id })
        assertNotNull(access.authenticate(room.board.id, colleagueSession.token, colleague))
        assertNotNull(access.authenticate(other.id, otherSession.token, room.visitor))
        assertNotNull(access.preview(room.board.id, room.inviteKey, colleague))
        repeat(2) { access.setMemberAccess(room.board.id, room.guest.id, false, room.owner) }
        error("unauthorized") { access.authenticate(room.board.id, room.guestToken, room.visitor) }
        error("unauthorized") { access.authenticate(room.board.id, tab.token, tabLogin) }
        val restored = access.join(room.board.id, JoinRequest(), room.visitor)
        assertEquals(room.guest.id, restored.participantId)
        assertNotEquals(room.guestToken, restored.token)
        assertNotNull(access.authenticate(room.board.id, restored.token, room.visitor))
        assertTrue(catalog.list(room.visitor, "shared", "", "recent", 24, null).items.any { it.id == room.board.id })
    }

    @Test
    fun `removal during poker preserves saved contributions and prevents further commands`() {
        val room = room()
        rounds.start(room.host, context(room.host))
        store.patch(room.guest, context(room.guest), listOf(shape("saved-private")), emptyMap())
        access.setMemberAccess(room.board.id, room.guest.id, true, room.owner)
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        error("unauthorized") { store.patch(room.guest, context(room.guest), listOf(shape("late")), emptyMap()) }
        error("unauthorized") { rounds.stop(room.guest, context(room.guest)) }
        rounds.stop(room.host, context(room.host))
        assertEquals(listOf("saved-private"), store.snapshot(room.host).elements.map { it.path("id").asText() })
    }

    @Test
    fun `concurrent rejoin and removal cannot leave an active membership or token`() {
        val room = room()
        val executor = Executors.newFixedThreadPool(2)
        try {
            val joined = executor.submit<JoinedBoard?> {
                try { access.join(room.board.id, JoinRequest(room.inviteKey), room.visitor) }
                catch (error: ClientException) { assertEquals("not_found", error.code); null }
            }
            val removed = executor.submit { access.setMemberAccess(room.board.id, room.guest.id, true, room.owner) }
            val session = joined.get()
            removed.get()
            if (session != null) error("unauthorized") { access.authenticate(room.board.id, session.token, room.visitor) }
            error("not_found") { access.join(room.board.id, JoinRequest(room.inviteKey), room.visitor) }
            assertTrue(access.members(room.board.id, room.owner).items.single { it.id == room.guest.id }.revoked)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `concurrent joins deduplicate identity and catalog pagination remains scoped`() {
        val owner = user()
        repeat(3) { access.create("Same", owner) }
        val first = catalog.list(owner, "mine", "Same", "name", 2, null)
        val second = catalog.list(owner, "mine", "Same", "name", 2, first.nextCursor)
        assertEquals(3, (first.items + second.items).map { it.id }.toSet().size)
        assertTrue(catalog.list(user(), "all", "", "recent", 24, null).items.isEmpty())
        error("bad_request") { catalog.list(user(), "mine", "Same", "name", 2, first.nextCursor) }
        val board = first.items.first()
        val executor = Executors.newFixedThreadPool(2)
        try {
            val a = executor.submit<JoinedBoard> { access.join(board.id, JoinRequest(), owner) }
            val b = executor.submit<JoinedBoard> { access.join(board.id, JoinRequest(), owner) }
            assertEquals(a.get().participantId, b.get().participantId)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `session expiry does not revoke membership or another tab and old canvases stay hidden`() {
        val room = room()
        val tab = access.join(room.board.id, JoinRequest(), room.visitor)
        dataSource.connection.use { c ->
            c.update(
                "UPDATE board_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=?",
                Security.hash(room.guestToken),
            )
        }
        error("unauthorized") { access.authenticate(room.board.id, room.guestToken, room.visitor) }
        assertEquals(room.guest.id, access.authenticate(room.board.id, tab.token, room.visitor).id)
        assertEquals(
            listOf(room.board.id),
            catalog.list(room.visitor, "all", "", "recent", 24, null).items.map { it.id },
        )
        assertEquals(
            room.guest.id,
            access.join(room.board.id, JoinRequest(), room.visitor).participantId,
        )
    }

    @Test
    fun `simultaneous first logins create one local account`() {
        val identity = user()
        val executor = Executors.newFixedThreadPool(2)
        try {
            val first = executor.submit<Account> { accounts.current(identity) }
            val second =
                executor.submit<Account> { accounts.current(identity.copy(sid = "second")) }
            assertEquals(first.get().id, second.get().id)
            assertNotEquals(
                first.get().id,
                accounts.current(identity.copy(issuer = "https://other.test/realm")).id,
            )
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `a second backend cannot acquire the writer lease`() {
        val first = SingleWriterGuard(dataSource)
        val second = SingleWriterGuard(dataSource)
        try {
            first.start()
            assertTrue(first.ownsDatabase())
            assertThrows(IllegalStateException::class.java) { second.start() }
        } finally {
            first.close()
        }
        val replacement = SingleWriterGuard(dataSource)
        try {
            replacement.start()
            assertTrue(replacement.ownsDatabase())
        } finally {
            replacement.close()
        }
    }

    @Test
    fun `deleted private text and unused images are never published`() {
        val room = room()
        rounds.start(room.host, context(room.host))
        val image =
            json.readTree(
                """{"id":"discarded-file","mimeType":"image/png","created":1,"dataURL":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="}"""
            )
        val element =
            (shape("discarded-image") as com.fasterxml.jackson.databind.node.ObjectNode)
                .put("type", "image")
                .put("fileId", "discarded-file")
        store.patch(
            room.guest,
            context(room.guest),
            listOf(element),
            mapOf("discarded-file" to image),
        )
        val deletedImage = element.deepCopy()
        deletedImage.put("isDeleted", true)
        val text =
            (shape("discarded-text") as com.fasterxml.jackson.databind.node.ObjectNode)
                .put("type", "text")
                .put("text", "Do not reveal")
                .put("isDeleted", true)
        store.patch(room.guest, context(room.guest), listOf(deletedImage, text), emptyMap())
        rounds.stop(room.guest, context(room.guest))
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        error("not_found") { store.asset(room.host, "discarded-file") }
    }
}
