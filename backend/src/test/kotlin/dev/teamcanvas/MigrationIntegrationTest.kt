package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.sql.Connection
import java.util.UUID
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.FlywayException
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.postgresql.ds.PGSimpleDataSource

/** Forward-upgrade fixture lives only in a freshly created, privately named schema. */
@EnabledIfEnvironmentVariable(named = "TEAM_CANVAS_TEST_JDBC_URL", matches = ".+")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class MigrationIntegrationTest {
    private val schema = "migration_" + UUID.randomUUID().toString().replace("-", "")
    private lateinit var source: PGSimpleDataSource
    private var ownsSchema = false
    private val json = jacksonObjectMapper()
    private val owner = UUID.randomUUID()
    private val member = UUID.randomUUID()
    private val board = UUID.randomUUID()
    private val page = UUID.randomUUID()
    private val round = UUID.randomUUID()
    private val host = UUID.randomUUID()
    private val guest = UUID.randomUUID()
    private val oldTables = listOf("app_users", "blocked_identities", "login_sessions", "boards", "participants",
        "board_sessions", "board_invitations", "canvas_pages", "rounds", "private_drafts", "elements", "assets",
        "command_receipts", "canvas_tags", "canvas_access_events")

    @BeforeAll
    fun setup() {
        source = PGSimpleDataSource().apply {
            setURL(System.getenv("TEAM_CANVAS_TEST_JDBC_URL"))
            user = System.getenv("DB_USER") ?: "board"
            password = System.getenv("DB_PASSWORD") ?: "board-test"
            currentSchema = schema
        }
        source.connection.use { it.update("CREATE SCHEMA $schema") }
        ownsSchema = true
        Flyway.configure().dataSource(source).schemas(schema).cleanDisabled(true).target("2").load().migrate()
    }

    @AfterAll
    fun cleanup() {
        if (ownsSchema) source.connection.use { it.update("DROP SCHEMA $schema CASCADE") }
    }

    private fun snapshot(c: Connection): JsonNode {
        // Every identifier is from the fixed V2 table list; no settings enter this SQL.
        val fields = oldTables.joinToString(",") { table ->
            "'$table',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM $table t)"
        }
        return c.query("SELECT jsonb_build_object($fields)") { it.next(); json.readTree(it.getString(1)) }
    }

    private fun history(c: Connection): Map<String, Int> = c.query(
        "SELECT version,checksum FROM flyway_schema_history WHERE version IS NOT NULL AND success ORDER BY installed_rank",
    ) { rows -> buildMap { while (rows.next()) put(rows.getString(1), rows.getInt(2)) } }

    private fun seedV2() {
        BoardRepository(source).transaction { c ->
            c.update("""INSERT INTO app_users(id,issuer,subject,display_name,username) VALUES
                (?, 'https://upgrade.example.test','owner','Persistent owner','upgrade.owner'),
                (?, 'https://upgrade.example.test','member','Persistent member','upgrade.member')""", owner, member)
            c.update("INSERT INTO boards(id,name,owner_user_id,template_visibility) VALUES(?,'Persistent V2 canvas',?,'public')", board, owner)
            c.update("INSERT INTO canvas_pages(id,board_id,position) VALUES(?,?,1)", page, board)
            c.update("INSERT INTO participants(id,board_id,user_id,name,role) VALUES(?,?,?,'Persistent owner','host'),(?,?,?,'Persistent member','guest')", host, board, owner, guest, board, member)
            c.update("INSERT INTO login_sessions(user_id,sid) VALUES(?,'upgrade-login'),(?,'upgrade-login')", owner, member)
            c.update("""INSERT INTO board_sessions(token_hash,participant_id,user_id,sid) VALUES
                (repeat('a',64),?,?,'upgrade-login'),(repeat('b',64),?,?,'upgrade-login')""", host, owner, guest, member)
            c.update("INSERT INTO board_invitations(id,board_id,creator_id,secret_hash) VALUES(?,?,?,repeat('c',64))", UUID.randomUUID(), board, owner)
            c.update("INSERT INTO rounds(id,board_id) VALUES(?,?)", round, board)
            c.update("UPDATE boards SET mode='poker',current_round_id=?,current_page_id=?,epoch=3,revision=2 WHERE id=?", round, page, board)
            c.update("INSERT INTO private_drafts(board_id,round_id,draft_hash) VALUES(?,?,repeat('d',64))", board, round)
            c.update("""INSERT INTO elements(board_id,id,page_id,body,scope,stored_bytes) VALUES
                (?,'public',?,'{"id":"public","type":"rectangle","x":1,"y":2,"width":10,"height":20}','public',100)""", board, page)
            c.update("""INSERT INTO elements(board_id,id,page_id,body,scope,draft_hash,round_id,stored_bytes) VALUES
                (?,'private',?,'{"id":"private","type":"image","fileId":"private-image"}','private',repeat('d',64),?,100)""", board, page, round)
            val image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="
            val publicImage = json.writeValueAsString(mapOf("id" to "public-image", "mimeType" to "image/png", "dataURL" to image))
            val privateImage = json.writeValueAsString(mapOf("id" to "private-image", "mimeType" to "image/png", "dataURL" to image))
            c.update("INSERT INTO assets(board_id,id,page_id,body,scope,stored_bytes) VALUES(?,'public-image',?,?::jsonb,'public',200)", board, page, publicImage)
            c.update("INSERT INTO assets(board_id,id,page_id,body,scope,draft_hash,round_id,stored_bytes) VALUES(?,'private-image',?,?::jsonb,'private',repeat('d',64),?,200)", board, page, privateImage, round)
            c.update("INSERT INTO command_receipts(board_id,receipt_scope,command_id,revision) VALUES(?,'public',?,1),(?,repeat('d',64),?,2)", board, UUID.randomUUID(), board, UUID.randomUUID())
            c.update("INSERT INTO canvas_tags(board_id,tag,normalized_tag) VALUES(?,'Architecture','architecture')", board)
            c.update("INSERT INTO canvas_access_events(board_id,actor_id,target_id,action) VALUES(?,?,?,'member_joined')", board, owner, member)
            c.update("INSERT INTO blocked_identities(fingerprint,key_id,action) VALUES(repeat('e',64),repeat('f',16),'delete')")
        }
    }

    @Test
    fun `populated V2 upgrades without resetting data and V3 audit works after validation`() {
        seedV2()
        val before = source.connection.use { c ->
            assertEquals(schema, c.query("SELECT current_schema()") { it.next(); it.getString(1) })
            snapshot(c)
        }
        val counts = mapOf("app_users" to 2, "boards" to 1, "canvas_pages" to 2, "participants" to 2,
            "board_sessions" to 2, "login_sessions" to 2, "board_invitations" to 1, "rounds" to 1,
            "private_drafts" to 1, "elements" to 2, "assets" to 2, "command_receipts" to 2,
            "blocked_identities" to 1, "canvas_tags" to 1, "canvas_access_events" to 1)
        counts.forEach { (table, count) -> assertEquals(count, before.path(table).size(), table) }
        val oldHistory = source.connection.use { history(it) }
        assertEquals(setOf("1", "2"), oldHistory.keys)

        val upgraded = Flyway.configure().dataSource(source).schemas(schema).cleanDisabled(true).load()
        assertEquals(1, upgraded.migrate().migrationsExecuted)
        source.connection.use { c ->
            assertEquals(before, snapshot(c), "Forward migration changed existing persisted data")
            val afterHistory = history(c)
            assertEquals(setOf("1", "2", "3"), afterHistory.keys)
            oldHistory.forEach { (version, checksum) -> assertEquals(checksum, afterHistory[version]) }
            assertTrue(AdminAudit.list(c).isEmpty())
            AdminAudit.record(c, owner, member, "reassign", "succeeded", board)
            val event = AdminAudit.list(c).single()
            assertEquals(owner, event.actorId)
            assertEquals(member, event.targetId)
            assertEquals(board, event.boardId)
            assertEquals("succeeded", event.result)
            assertTrue(event.createdAt.isNotBlank())
            c.update("INSERT INTO admin_audit_events(actor_id,target_id,action,result,created_at) VALUES(?,?,'deactivate','succeeded',now()-interval '91 days')", owner, member)
            assertEquals(1, AdminAudit.list(c).size)
            assertEquals(1, AdminAudit.cleanup(c))
            assertEquals(1, AdminAudit.list(c).size)
            assertEquals(before, snapshot(c), "Audit operations changed pre-existing data")
        }
        assertDoesNotThrow { upgraded.validate() }
        assertEquals(0, upgraded.migrate().migrationsExecuted, "Repeated migration should be a no-op")
        source.connection.use { c -> assertEquals(before, snapshot(c)) }

        // A checksum mismatch must fail validation, never reset the populated schema.
        source.connection.use { it.update("UPDATE flyway_schema_history SET checksum=checksum+1 WHERE version='2'") }
        assertThrows(FlywayException::class.java) { upgraded.migrate() }
        source.connection.use { c ->
            assertEquals(before, snapshot(c), "Failed migration reset or changed existing data")
            assertEquals(1, AdminAudit.list(c).size)
        }
    }
}
