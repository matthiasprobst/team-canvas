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
    private fun act(actor: UUID, target: UUID, action: String) = service.change(actor, target, action, service.impact(target).token, "${action.uppercase()} $target")


    @Test fun `same names are distinguished by searchable username and full account id`() {
        val first = identity("Same Person").copy(username = "person.first")
        val second = identity("Same Person").copy(username = "person.second")
        val firstId = accounts.current(first).id
        val secondId = accounts.current(second).id
        assertEquals(firstId, service.list(0, "person.first").items.single().id)
        assertEquals(secondId, service.list(0, secondId.toString()).items.single().id)
        assertEquals("person.second", service.impact(secondId).user.username)
        val admin = accounts.current(identity("Administrator")).id
        error("bad_request") { service.change(admin, secondId, "delete", service.impact(secondId).token, "DELETE $firstId") }
        error("bad_request") { service.change(admin, secondId, "delete", service.impact(secondId).token, "DELETE") }
        assertEquals("active", service.impact(secondId).user.status)
    }

    @Test fun `admin audit persists outcomes and erases account links on anonymization`() {
        val admin = accounts.current(identity("Auditor")).id
        val owner = identity("Audit target")
        val target = accounts.current(owner).id
        val board = access.create("Must not appear in audit", owner)
        act(admin, target, "deactivate")
        act(admin, target, "reactivate")
        error("bad_request") { service.change(admin, target, "delete", service.impact(target).token, "DELETE") }
        val events = service.audit().filter { it.targetId == target }
        assertEquals(setOf("succeeded", "rejected"), events.map { it.result }.toSet())
        assertTrue(events.all { it.actorId == admin && it.createdAt.isNotBlank() && it.boardId == null })
        act(admin, target, "anonymize")
        source.connection.use { c ->
            assertEquals(0L, c.query("SELECT count(*) FROM admin_audit_events WHERE target_id=? OR actor_id=?", target, target) { it.next(); it.getLong(1) })
            assertTrue(c.query("SELECT 1 FROM admin_audit_events WHERE action='anonymize' AND result='succeeded' AND actor_id=? AND target_id IS NULL AND board_id IS NULL", admin) { it.next() })
        }
        assertNotNull(service.impact(repository.transaction { c -> c.query("SELECT owner_user_id FROM boards WHERE id=?", board.id) { it.next(); it.getObject(1, UUID::class.java) } }))
        // Actor references are scrubbed too when an administrator later leaves.
        val successor = accounts.current(identity("Successor")).id
        act(successor, admin, "anonymize")
        source.connection.use { c -> assertEquals(0L, c.query("SELECT count(*) FROM admin_audit_events WHERE actor_id=? OR target_id=?", admin, admin) { it.next(); it.getLong(1) }) }
    }

    @Test fun `admin audit is transactional and retention cleanup is bounded`() {
        val admin = accounts.current(identity("Retention administrator")).id
        val target = accounts.current(identity("Retention target")).id
        assertThrows(IllegalStateException::class.java) {
            repository.transaction { c ->
                AdminAudit.record(c, admin, target, "deactivate", "succeeded")
                throw IllegalStateException("rollback")
            }
        }
        assertFalse(service.audit().any { it.actorId == admin })
        repository.transaction { c ->
            c.update("""INSERT INTO admin_audit_events(actor_id,target_id,action,result,created_at)
                SELECT ?,?,'deactivate','succeeded',now()-interval '91 days' FROM generate_series(1,501)""", admin, target)
            assertFalse(AdminAudit.list(c).any { it.actorId == admin })
            assertEquals(500, AdminAudit.cleanup(c))
            assertEquals(1L, c.query("SELECT count(*) FROM admin_audit_events WHERE actor_id=?", admin) { it.next(); it.getLong(1) })
            assertEquals(1, AdminAudit.cleanup(c))
            AdminAudit.record(c, admin, target, "deactivate", "succeeded")
            assertEquals(0, AdminAudit.cleanup(c))
        }
        assertTrue(service.audit().any { it.actorId == admin && it.targetId == target })
    }

    @Test fun `runtime role can create and join canvases without schema privileges`() {
        val role = "runtime_" + UUID.randomUUID().toString().replace("-", "")
        source.connection.use { c ->
            c.update("CREATE ROLE $role NOLOGIN")
            c.update("GRANT USAGE ON SCHEMA $schema TO $role")
            c.update("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA $schema TO $role")
            c.update("REVOKE ALL ON $schema.flyway_schema_history FROM $role")
            c.update("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA $schema TO $role")
        }
        try {
            val restricted = PGSimpleDataSource().apply {
                setURL(System.getenv("TEAM_CANVAS_TEST_JDBC_URL")); user = source.user; password = source.password
                currentSchema = schema; options = "-c role=$role"
            }
            val runtimeRepository = BoardRepository(restricted)
            val runtimeAccounts = Accounts(runtimeRepository)
            val runtimeAccess = CanvasAccess(runtimeRepository, runtimeAccounts)
            val owner = identity("Runtime role")
            val board = runtimeAccess.create("Created without DDL privileges", owner)
            val joined = runtimeAccess.join(board.id, JoinRequest(), owner)
            assertEquals("host", runtimeAccess.authenticate(board.id, joined.token, owner).role)
            restricted.connection.use { c ->
                assertThrows(java.sql.SQLException::class.java) { c.update("CREATE TABLE forbidden_ddl(id int)") }
                assertThrows(java.sql.SQLException::class.java) { c.update("ALTER TABLE boards ADD COLUMN forbidden int") }
                assertThrows(java.sql.SQLException::class.java) { c.update("DELETE FROM flyway_schema_history") }
            }
        } finally {
            source.connection.use { c -> c.update("DROP OWNED BY $role"); c.update("DROP ROLE $role") }
        }
    }

    @Test fun `restore reapplies anonymous and destructive offboarding instead of resurrecting identities`() {
        val admin = accounts.current(identity("Administrator")).id
        val anonymized = identity("Restore anonymous identity")
        val deleted = identity("Restore deleted identity")
        val anonId = accounts.current(anonymized).id
        val deleteId = accounts.current(deleted).id
        access.create("Retained before backup", anonymized)
        access.create("Deleted before backup", deleted)
        act(admin, anonId, "anonymize")
        act(admin, deleteId, "delete")
        val saved = source.connection.use { RecoveryPreparation.export(it) }
        val oldAnonymousBoard = UUID.randomUUID()
        val oldDeletedBoard = UUID.randomUUID()
        repository.transaction { c ->
            for ((id, user) in listOf(anonId to anonymized, deleteId to deleted))
                c.update("INSERT INTO app_users(id,issuer,subject,display_name) VALUES(?,?,?,?)", id, user.issuer, user.subject, user.name)
            c.update("INSERT INTO boards(id,name,owner_user_id) VALUES(?,?,?)", oldAnonymousBoard, "Restored anonymous work", anonId)
            c.update("INSERT INTO boards(id,name,owner_user_id) VALUES(?,?,?)", oldDeletedBoard, "Restored deleted work", deleteId)
            assertEquals(2, RecoveryPreparation.prepare(c, saved, IdentityBlocks()))
        }
        source.connection.use { c ->
            assertEquals(0L, c.query("SELECT count(*) FROM app_users WHERE id IN (?,?)", anonId, deleteId) { it.next(); it.getLong(1) })
            assertTrue(c.query("SELECT 1 FROM boards WHERE id=?", oldAnonymousBoard) { it.next() })
            assertFalse(c.query("SELECT 1 FROM boards WHERE id=?", oldDeletedBoard) { it.next() })
            assertEquals(0L, c.query("SELECT count(*) FROM board_sessions") { it.next(); it.getLong(1) })
            assertEquals(0L, c.query("SELECT count(*) FROM login_sessions WHERE NOT revoked") { it.next(); it.getLong(1) })
        }
        error("unauthorized") { accounts.current(anonymized.copy(sid="after-restore")) }
        error("unauthorized") { accounts.current(deleted.copy(sid="after-restore")) }
        assertThrows(IllegalArgumentException::class.java) {
            repository.transaction { RecoveryPreparation.prepare(it, saved.copy(records=listOf(OffboardingRecord("a".repeat(64), "0".repeat(16), "delete"))), IdentityBlocks()) }
        }
    }

    @Test fun `cleanup is bounded and does not delete revocation or identity blocks`() {
        val owner = identity()
        val account = accounts.current(owner)
        val board = access.create("Cleanup", owner)
        val joined = access.join(board.id, JoinRequest(), owner)
        repository.transaction { c ->
            c.update("""INSERT INTO board_sessions(token_hash,participant_id,user_id,sid,expires_at)
                SELECT repeat(md5(g::text),2),?,?,?,now()-interval '1 day' FROM generate_series(1,501) g""", joined.participantId, account.id, owner.sid)
            assertTrue(ExpiredRecords.cleanup(c) in 500..1500)
            assertEquals(1L, c.query("SELECT count(*) FROM board_sessions WHERE user_id=? AND expires_at<now()", account.id) { it.next(); it.getLong(1) })
        }
        assertNotNull(access.authenticate(board.id, joined.token, owner))
    }

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
        error("conflict") { service.change(admin, id, "delete", preview.token, "DELETE $id") }
        error("bad_request") { service.change(admin, id, "delete", service.impact(id).token, "") }
        error("forbidden") { service.change(id, id, "delete", service.impact(id).token, "DELETE $id") }
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
