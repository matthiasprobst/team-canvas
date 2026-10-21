package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.util.UUID
import java.util.concurrent.Executors
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.postgresql.ds.PGSimpleDataSource

@EnabledIfEnvironmentVariable(named = "TEAM_CANVAS_TEST_JDBC_URL", matches = ".+")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LifecycleIntegrationTest {
    private val schema = "lifecycle_" + UUID.randomUUID().toString().replace("-", "")
    private lateinit var source: PGSimpleDataSource
    private lateinit var repository: BoardRepository
    private lateinit var accounts: Accounts
    private lateinit var access: CanvasAccess
    private lateinit var service: AdminService
    private lateinit var catalog: CanvasCatalog
    private lateinit var store: BoardStore
    private val json = jacksonObjectMapper()
    private fun identity(name: String = "Departing") = LoginIdentity("https://identity.test", UUID.randomUUID().toString(), UUID.randomUUID().toString(), name)
    private fun error(code: String, action: () -> Unit) = assertEquals(code, assertThrows(ClientException::class.java, action).code)

    @BeforeAll fun setup() {
        source = PGSimpleDataSource().apply {
            setURL(System.getenv("TEAM_CANVAS_TEST_JDBC_URL")); user = System.getenv("DB_USER") ?: "board"; password = System.getenv("DB_PASSWORD") ?: "board-test"; currentSchema = schema
        }
        Flyway.configure().dataSource(source).schemas(schema).load().migrate()
        repository = BoardRepository(source)
        accounts = Accounts(repository)
        access = CanvasAccess(repository, accounts)
        service = AdminService(repository)
        catalog = CanvasCatalog(repository, accounts, access)
        store = BoardStore(repository, SceneRepository(json), json)
    }
    @AfterAll fun cleanup() { source.connection.use { it.update("DROP SCHEMA IF EXISTS $schema CASCADE") } }
    private fun act(actor: UUID, target: UUID, action: String) = service.change(actor, target, action, service.impact(target).token, action.uppercase())

    @Test fun `deactivation rejects old sessions and reactivation requires fresh login`() {
        val admin = accounts.current(identity("Administrator")).id
        val user = identity()
        val account = accounts.current(user)
        val board = access.create("Keep", user)
        val joined = access.join(board.id, JoinRequest(), user)
        val who = access.authenticate(board.id, joined.token, user)
        act(admin, account.id, "deactivate")
        error("unauthorized") { accounts.current(user) }
        error("unauthorized") { store.snapshot(who) }
        error("unauthorized") { access.authenticate(board.id, joined.token, user) }
        act(admin, account.id, "reactivate")
        error("unauthorized") { accounts.current(user) }
        assertEquals(account.id, accounts.current(user.copy(sid=UUID.randomUUID().toString())).id)
        assertEquals(1, service.impact(account.id).canvases.size)
    }

    @Test fun `anonymization preserves all owned shared content and erases live identity links`() {
        val admin = accounts.current(identity("Administrator")).id
        val owner = identity("Sensitive name")
        val member = identity("Collaborator")
        val account = accounts.current(owner)
        val board = access.create("Retained architecture", owner)
        val privateBoard = access.create("Owner only", owner)
        val key = access.invite(board.id, owner).getValue("inviteKey")
        val joined = access.join(board.id, JoinRequest(key), member)
        val who = access.authenticate(board.id, joined.token, member)
        val before = store.snapshot(who)
        store.patch(who, CommandContext(UUID.randomUUID(), before.board.epoch, null, before.board.pageId), listOf(json.readTree("""{"id":"shared","type":"rectangle","x":0,"y":0,"width":1,"height":1}""")), emptyMap())
        assertEquals(2, act(admin, account.id, "anonymize").first.affectedCanvases)
        assertEquals(1, store.snapshot(who).elements.size)
        error("unauthorized") { accounts.current(owner.copy(sid=UUID.randomUUID().toString())) }
        error("not_found") { service.impact(account.id) }
        val retained = catalog.list(member, "shared", "", "recent", 24, null).items.single { it.id == board.id }
        assertTrue(retained.owner.displayName.startsWith("deleted_user_"))
        assertEquals(2, service.impact(retained.owner.id).canvases.size)
        source.connection.use { c ->
            assertEquals(0L, c.query("SELECT count(*) FROM app_users WHERE subject=? OR display_name=?", owner.subject, owner.name) { it.next(); it.getLong(1) })
            assertEquals(0L, c.query("SELECT count(*) FROM participants WHERE user_id=? OR name=?", account.id, owner.name) { it.next(); it.getLong(1) })
            assertTrue(c.query("SELECT 1 FROM boards WHERE id=?", privateBoard.id) { it.next() })
        }
        val replacement = service.impact(retained.owner.id)
        error("bad_request") { service.change(admin, replacement.user.id, "reactivate", replacement.token, "") }
        service.reassign(admin, board.id, accounts.current(member).id)
        assertEquals("host", access.join(board.id, JoinRequest(), member).role)
    }

    @Test fun `deletion removes every owned canvas but never other owners drawings`() {
        val admin = accounts.current(identity("Administrator")).id
        val owner = identity()
        val other = identity("Other")
        val userId = accounts.current(owner).id
        val owned = access.create("Delete even if shared", owner)
        val privateBoard = access.create("Delete private too", owner)
        val otherBoard = access.create("Keep other owner", other)
        access.join(owned.id, JoinRequest(access.invite(owned.id, owner).getValue("inviteKey")), other)
        val membership = access.join(otherBoard.id, JoinRequest(access.invite(otherBoard.id, other).getValue("inviteKey")), owner)
        val who = access.authenticate(otherBoard.id, membership.token, owner)
        val state = store.snapshot(who).board
        store.patch(who, CommandContext(UUID.randomUUID(), state.epoch, null, state.pageId), listOf(json.readTree("""{"id":"unattributed","type":"rectangle","x":0,"y":0,"width":1,"height":1}""")), emptyMap())
        act(admin, userId, "delete")
        assertEquals(listOf(otherBoard.id), catalog.list(other, "mine", "", "recent", 24, null).items.map { it.id })
        val keep = access.join(otherBoard.id, JoinRequest(), other)
        assertEquals(1, store.snapshot(access.authenticate(otherBoard.id, keep.token, other)).elements.size)
        error("unauthorized") { accounts.current(owner) }
        source.connection.use { c -> assertEquals(0L, c.query("SELECT count(*) FROM boards WHERE id IN (?,?)", owned.id, privateBoard.id) { it.next(); it.getLong(1) }) }
    }

    @Test fun `stale impact and missing irreversible confirmation have no destructive effect`() {
        val admin = accounts.current(identity("Administrator")).id
        val owner = identity()
        val id = accounts.current(owner).id
        val preview = service.impact(id)
        access.create("Created after preview", owner)
        error("conflict") { service.change(admin, id, "delete", preview.token, "DELETE") }
        error("bad_request") { service.change(admin, id, "delete", service.impact(id).token, "") }
        error("forbidden") { service.change(id, id, "delete", service.impact(id).token, "DELETE") }
        assertEquals("active", service.impact(id).user.status)
    }

    @Test fun `anonymization and concurrent provisioning cannot resurrect identity`() {
        val admin = accounts.current(identity("Administrator")).id
        val owner = identity()
        val id = accounts.current(owner).id
        val pool = Executors.newFixedThreadPool(2)
        try {
            val first = pool.submit { act(admin, id, "anonymize") }
            val second = pool.submit { try { accounts.current(owner.copy(sid="racing-login")) } catch (_: ClientException) { } }
            first.get(); second.get()
        } finally { pool.shutdownNow() }
        error("unauthorized") { accounts.current(owner.copy(sid="later-login")) }
        source.connection.use { c -> assertEquals(0L, c.query("SELECT count(*) FROM app_users WHERE issuer=? AND subject=?", owner.issuer, owner.subject) { it.next(); it.getLong(1) }) }
    }
}
