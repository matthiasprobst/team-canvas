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
            access.authenticate(board.id, host.token, owner),
            access.authenticate(board.id, guest.token, visitor),
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
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
        error("poker_active") { pages.create(room.host, context(room.host), false, false) }
        error("poker_active") { pages.select(room.guest, context(room.guest), first) }
        val patch = store.patch(room.guest, context(room.guest), listOf(shape("poker")), emptyMap())
        rounds.ready(room.guest, context(room.guest), patch.result.ack.revision)
        rounds.ready(room.host, context(room.host), 0)
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
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
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
            assertEquals(0L, c.query("SELECT count(*) FROM round_participants WHERE round_id=?", roundId) {
                it.next(); it.getLong(1)
            })
            for (table in listOf("board_sessions", "command_receipts")) {
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

        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
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
        assertEquals(setOf("shared-shape", "public-image"), copiedScene.elements.map { it.path("id").asText() }.toSet())
        assertEquals(listOf("public-file"), copiedScene.fileIds)
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
    fun `private elements and images reveal only when every roster member is ready`() {
        val room = room()
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
        val guestContext = context(room.guest)
        val image =
            json.readTree(
                """{"id":"file","mimeType":"image/png","created":1,"dataURL":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="}"""
            )
        val imageElement =
            (shape("image") as com.fasterxml.jackson.databind.node.ObjectNode)
                .put("type", "image")
                .put("fileId", "file")
        val saved =
            store.patch(
                room.guest,
                guestContext,
                listOf(shape("private"), imageElement),
                mapOf("file" to image),
            )
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        error("not_found") { store.asset(room.host, "file") }
        assertNotNull(store.asset(room.guest, "file"))
        error("unsaved_draft") { rounds.ready(room.guest, context(room.guest), 0) }
        rounds.ready(room.guest, context(room.guest), saved.result.ack.revision)
        assertEquals("poker", store.snapshot(room.host).board.mode)
        error("locked") {
            store.patch(room.guest, context(room.guest), listOf(shape("late")), emptyMap())
        }
        val last = rounds.ready(room.host, context(room.host), 0)
        assertTrue(last.transitioned)
        assertEquals("standard", store.snapshot(room.guest).board.mode)
        assertEquals(2, store.snapshot(room.host).elements.size)
        assertNotNull(store.asset(room.host, "file"))
        error("stale_round") {
            store.patch(
                room.guest,
                guestContext.copy(commandId = UUID.randomUUID()),
                listOf(shape("stale")),
                emptyMap(),
            )
        }
    }

    @Test
    fun `retries do not apply a command twice and unauthorized users cannot control rounds`() {
        val room = room()
        error("forbidden") { rounds.start(room.guest, context(room.guest), setOf(room.guest.id)) }
        val command = context(room.host)
        val first = store.patch(room.host, command, listOf(shape("public")), emptyMap())
        val retry = store.patch(room.host, command, listOf(shape("public", 99)), emptyMap())
        assertTrue(retry.result.duplicate)
        assertEquals(first.result.ack, retry.result.ack)
        assertEquals(0, store.snapshot(room.host).elements.single().path("x").asInt())
    }

    @Test
    fun `late arrivals are excluded and cancelling never publishes private content`() {
        val room = room()
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
        val identity = user("Late")
        val late = access.join(room.board.id, JoinRequest(room.inviteKey), identity)
        val lateWho = access.authenticate(room.board.id, late.token, identity)
        assertFalse(store.snapshot(lateWho).round!!.included)
        error("locked") {
            store.patch(lateWho, context(lateWho), listOf(shape("late")), emptyMap())
        }
        store.patch(room.guest, context(room.guest), listOf(shape("secret")), emptyMap())
        error("forbidden") { rounds.cancel(room.guest, context(room.guest)) }
        rounds.cancel(room.host, context(room.host))
        assertTrue(store.snapshot(room.guest).elements.isEmpty())
        assertTrue(store.snapshot(room.host).elements.isEmpty())
    }

    @Test
    fun `simultaneous final ready commands reveal exactly once`() {
        val room = room()
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
        val host = context(room.host)
        val guest = context(room.guest)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val a = executor.submit<CommandResult> { rounds.ready(room.host, host, 0) }
            val b = executor.submit<CommandResult> { rounds.ready(room.guest, guest, 0) }
            val results = listOf(a.get(), b.get())
            assertEquals(1, results.count { it.transitioned })
            assertEquals("standard", store.snapshot(room.host).board.mode)
            assertTrue(rounds.ready(room.host, host, 0).duplicate)
        } finally {
            executor.shutdownNow()
        }
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
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
        store.patch(room.guest, context(room.guest), listOf(shape("private")), emptyMap())
        val tab = access.join(room.board.id, JoinRequest(), room.visitor)
        assertEquals(room.guest.id, tab.participantId)
        assertNotEquals(room.guestToken, tab.token)
        assertEquals(
            1,
            store
                .snapshot(access.authenticate(room.board.id, tab.token, room.visitor))
                .elements
                .size,
        )
        assertEquals(2, store.snapshot(room.host).round!!.members.size)
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        access.revoke(room.board.id, room.owner, false)
        assertNotNull(access.authenticate(room.board.id, tab.token, room.visitor))
        error("not_found") { access.preview(room.board.id, anotherKey, room.visitor) }
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
            c.update(
                "INSERT INTO boards(id,name,host_key_hash) VALUES(?,?,?)",
                UUID.randomUUID(),
                "Legacy",
                Security.hash("old-key"),
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
        rounds.start(room.host, context(room.host), setOf(room.host.id, room.guest.id))
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
        val revision = store.snapshot(room.guest).round!!.draftRevision
        rounds.ready(room.guest, context(room.guest), revision)
        rounds.ready(room.host, context(room.host), 0)
        assertTrue(store.snapshot(room.host).elements.isEmpty())
        error("not_found") { store.asset(room.host, "discarded-file") }
    }
}
