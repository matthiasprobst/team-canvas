package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import io.micrometer.core.instrument.MeterRegistry
import jakarta.annotation.PreDestroy
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.inject.spi.CDI
import jakarta.inject.Inject
import jakarta.websocket.*
import jakarta.websocket.server.ServerEndpoint
import jakarta.websocket.server.ServerEndpointConfig
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import org.eclipse.microprofile.jwt.JsonWebToken
import org.jboss.logging.Logger

class BoardEndpointConfigurator : ServerEndpointConfig.Configurator() {
    override fun checkOrigin(originHeaderValue: String?): Boolean =
        CDI.current().select(AccessPolicy::class.java).get().allowsOrigin(originHeaderValue)
}

/** One ordered, bounded send queue per socket; a slow reader cannot accumulate unlimited data. */
private class Peer(val session: Session, val subject: String?, val authExpiresAt: Long) {
    @Volatile var participant: Participant? = null
    var token: String = ""
    var lastCursorAt = 0L
    var lastResyncAt = 0L
    @Volatile var lastAuthAt = 0L
    val openedAt = System.currentTimeMillis()
    private val queue = ArrayDeque<String>()
    private var queuedBytes = 0L
    private var closing: Pair<Int, String>? = null

    @Synchronized
    fun send(text: String) {
        if (!session.isOpen) return
        val size = text.toByteArray(Charsets.UTF_8).size
        if (queue.size >= 64 || queuedBytes + size > 8_000_000) {
            deferClose(1013, "Slow reader")
            return
        }
        queue.addLast(text)
        queuedBytes += size
        if (queue.size == 1) sendNext()
    }

    @Synchronized
    private fun sendNext() {
        val text =
            queue.peekFirst()
                ?: run {
                    closing?.let { deferClose(it.first, it.second) }
                    return
                }
        try {
            session.asyncRemote.sendText(text) { result ->
                synchronized(this) {
                    if (!result.isOK) {
                        deferClose(1011, "Delivery failed")
                        return@synchronized
                    }
                    queue.pollFirst()?.let { queuedBytes -= it.toByteArray(Charsets.UTF_8).size }
                    if (session.isOpen) sendNext()
                }
            }
        } catch (_: Exception) {
            deferClose(1011, "Delivery failed")
        }
    }

    private fun deferClose(code: Int, reason: String) {
        java.util.concurrent.CompletableFuture.runAsync { close(code, reason) }
    }

    @Synchronized
    fun closeAfterDrain(code: Int, reason: String) {
        closing = code to reason
        if (queue.isEmpty()) deferClose(code, reason)
    }

    fun close(code: Int, reason: String) {
        try {
            session.close(CloseReason(CloseReason.CloseCodes.getCloseCode(code), reason))
        } catch (_: Exception) {}
    }
}

@ApplicationScoped
class RoomHub
@Inject
constructor(
    private val store: BoardStore,
    private val rounds: RoundService,
    private val json: ObjectMapper,
    private val access: AccessPolicy,
    private val limits: RequestLimits,
    private val writer: SingleWriterGuard,
    private val metrics: MeterRegistry,
) {
    private val log = Logger.getLogger(RoomHub::class.java)
    private val peers = ConcurrentHashMap<String, Peer>()
    // Fixed stripes avoid retaining locks for arbitrary or abandoned board IDs.
    private val locks = Array(256) { Any() }
    private val modes = ConcurrentHashMap<UUID, String>()
    private val capacity = Semaphore(200)
    private val sweeper =
        Executors.newSingleThreadScheduledExecutor { task ->
            Thread(task, "team-canvas-sessions").apply { isDaemon = true }
        }

    init {
        metrics.gauge("team.canvas.connections", peers) { it.size.toDouble() }
        sweeper.scheduleAtFixedRate({ sweep() }, 1, 1, TimeUnit.SECONDS)
    }

    private fun lock(id: UUID) = locks[Math.floorMod(id.hashCode(), locks.size)]

    private fun audience(id: UUID) = peers.values.filter { it.participant?.boardId == id }

    private fun send(peer: Peer, event: Any) = peer.send(json.writeValueAsString(event))

    @Synchronized
    fun open(session: Session) {
        if (!capacity.tryAcquire()) {
            session.close(
                CloseReason(CloseReason.CloseCodes.getCloseCode(1013), "Server connection limit")
            )
            return
        }
        try {
            val subject = access.subject(session.userPrincipal)
            if (subject != null && peers.values.count { it.subject == subject } >= 20)
                throw ClientException("rate_limit", "Zu viele Verbindungen für dieses Firmenkonto")
            val expiresAt =
                (session.userPrincipal as? JsonWebToken)?.expirationTime?.times(1000)
                    ?: if (access.authRequired)
                        throw ClientException("unauthorized", "OIDC-Identität fehlt")
                    else Long.MAX_VALUE
            session.maxTextMessageBufferSize = 4096
            session.maxIdleTimeout = 30 * 60_000L
            session.asyncRemote.sendTimeout = 5000
            peers[session.id] = Peer(session, subject, expiresAt)
        } catch (_: Exception) {
            capacity.release()
            session.close(
                CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY, "Authentication required")
            )
        }
    }

    fun message(session: Session, text: String) {
        val peer = peers[session.id] ?: return
        var commandId: String? = null
        var boardId: UUID? = null
        var type = "unknown"
        try {
            writer.requireOwner()
            if (System.currentTimeMillis() >= peer.authExpiresAt)
                throw ClientException("unauthorized", "Anmeldung abgelaufen")
            limits.require("socket:${session.id}", 60)
            val bytes = text.toByteArray(Charsets.UTF_8).size
            if (bytes > 2_000_000) throw ClientException("too_large", "Nachricht zu groß")
            val packet =
                try {
                    json.readTree(text)
                } catch (_: com.fasterxml.jackson.core.JsonProcessingException) {
                    throw ClientException("bad_request", "Ungültige JSON-Nachricht")
                }
            if (packet == null || !packet.isObject)
                throw ClientException("bad_request", "Ungültige Nachricht")
            type = packet.path("type").asText()
            boardId = UUID.fromString(session.requestURI.path.substringAfterLast('/'))
            commandId =
                packet
                    .path("commandId")
                    .takeIf { it.isTextual && it.asText().length <= 36 }
                    ?.asText()
            limits.require("bytes:${session.id}", 8_000_000, 10_000, bytes)
            limits.require("bytes:global", 64_000_000, 10_000, bytes)
            synchronized(lock(boardId)) {
                if (type == "hello") {
                    if (peer.participant != null)
                        throw ClientException("invalid_state", "Bereits angemeldet")
                    val token = packet.path("token").asText("")
                    val who = store.authenticate(boardId, token, peer.subject)
                    if (audience(boardId).size >= 10)
                        throw ClientException("room_full", "Maximal 10 aktive Verbindungen")
                    peer.participant = who
                    peer.token = token
                    peer.lastAuthAt = System.currentTimeMillis()
                    session.maxTextMessageBufferSize = 2_000_000
                    snapshot(peer)
                    presence(boardId)
                    return@synchronized
                }
                val who =
                    peer.participant
                        ?: throw ClientException("unauthorized", "Bitte zuerst anmelden")
                if (type == "ping") {
                    send(peer, mapOf("type" to "pong"))
                    return@synchronized
                }
                if (type == "cursor") {
                    cursor(peer, packet)
                    return@synchronized
                }
                store.authenticate(boardId, peer.token, peer.subject)
                peer.lastAuthAt = System.currentTimeMillis()
                if (type == "resync") {
                    val now = System.currentTimeMillis()
                    if (now - peer.lastResyncAt < 2000)
                        throw ClientException("rate_limit", "Bitte kurz warten")
                    peer.lastResyncAt = now
                    snapshot(peer)
                    return@synchronized
                }
                limits.require("writes:${session.id}", 20)
                val context = context(packet)
                val result =
                    when (type) {
                        "patch" -> {
                            val elements =
                                ElementValidation.validateElements(packet.path("elements"))
                            val files = ElementValidation.validateFiles(packet.get("files"))
                            val patch = store.patch(who, context, elements, files)
                            if (!patch.result.duplicate) {
                                val event =
                                    mapOf(
                                        "type" to "patch",
                                        "commandId" to context.commandId,
                                        "revision" to patch.result.ack.revision,
                                        "actorId" to who.id,
                                        "scope" to patch.scope,
                                        "elements" to elements,
                                        "fileIds" to files.keys,
                                    )
                                audience(boardId)
                                    .filter {
                                        patch.scope == "public" || it.participant?.id == who.id
                                    }
                                    .forEach { send(it, event) }
                            }
                            patch.result
                        }
                        "start_round" ->
                            rounds.start(
                                who,
                                context,
                                audience(boardId).mapNotNull { it.participant?.id }.toSet(),
                            )
                        "done" -> {
                            val revision = packet.path("draftRevision")
                            if (!revision.isIntegralNumber || !revision.canConvertToLong())
                                throw ClientException("bad_request", "Entwurfsrevision fehlt")
                            rounds.ready(who, context, revision.asLong())
                        }
                        "cancel_round" -> rounds.cancel(who, context)
                        else ->
                            throw ClientException("invalid_message", "Unbekannter Nachrichtentyp")
                    }
                send(peer, result.ack)
                metrics.counter("team.canvas.commands", "type", type).increment()
                if (!result.duplicate && type != "patch") {
                    if (result.transitioned) audience(boardId).forEach { snapshot(it) }
                    else
                        audience(boardId).forEach {
                            val data = store.roundState(it.participant!!)
                            send(
                                it,
                                mapOf(
                                    "type" to "round",
                                    "board" to data.first,
                                    "round" to data.second,
                                ),
                            )
                        }
                    presence(boardId)
                }
            }
        } catch (error: ClientException) {
            metrics.counter("team.canvas.rejections", "code", error.code).increment()
            send(
                peer,
                mapOf(
                    "type" to "error",
                    "commandId" to commandId,
                    "code" to error.code,
                    "message" to error.message,
                ),
            )
            if (error.code in setOf("unauthorized", "room_full"))
                peer.closeAfterDrain(1008, error.code)
            if (error.code == "unavailable" || (error.code == "rate_limit" && commandId == null))
                peer.closeAfterDrain(1013, error.code)
        } catch (_: IllegalArgumentException) {
            send(
                peer,
                mapOf(
                    "type" to "error",
                    "commandId" to commandId,
                    "code" to "bad_request",
                    "message" to "Ungültige Nachricht",
                ),
            )
        } catch (error: Exception) {
            log.errorf(
                "Command failed board=%s type=%s command=%s exception=%s sqlState=%s",
                boardId,
                type.takeIf {
                    it in
                        setOf(
                            "hello",
                            "patch",
                            "start_round",
                            "done",
                            "cancel_round",
                            "resync",
                            "cursor",
                            "ping",
                        )
                } ?: "unknown",
                commandId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                error.javaClass.simpleName,
                (error as? java.sql.SQLException)?.sqlState,
            )
            // Outcome may already be committed. Reconnect and retry the same command ID.
            peer.close(1011, "Temporary server error")
        }
    }

    private fun context(packet: JsonNode): CommandContext {
        val epoch = packet.path("epoch")
        if (
            !epoch.isIntegralNumber ||
                !epoch.canConvertToLong() ||
                epoch.asLong() < 0 ||
                !packet.has("roundId")
        )
            throw ClientException("bad_request", "Rundenkontext fehlt")
        return CommandContext(
            UUID.fromString(packet.path("commandId").asText()),
            epoch.asLong(),
            packet.get("roundId").takeUnless { it.isNull }?.let { UUID.fromString(it.asText()) },
        )
    }

    private fun snapshot(peer: Peer) {
        val data = store.snapshot(peer.participant!!)
        modes[data.board.id] = data.board.mode
        send(peer, mapOf("type" to "snapshot", "data" to data))
    }

    private fun presence(id: UUID) {
        val participants =
            audience(id)
                .mapNotNull { it.participant }
                .distinctBy { it.id }
                .map { mapOf("id" to it.id, "name" to it.name, "role" to it.role) }
        audience(id).forEach {
            send(it, mapOf("type" to "presence", "participants" to participants))
        }
    }

    private fun cursor(peer: Peer, packet: JsonNode) {
        val who = peer.participant!!
        if (modes[who.boardId] != "standard") return
        val now = System.currentTimeMillis()
        if (now - peer.lastCursorAt < 60) return
        val x = packet.path("x").asDouble(Double.NaN)
        val y = packet.path("y").asDouble(Double.NaN)
        if (
            !x.isFinite() ||
                !y.isFinite() ||
                kotlin.math.abs(x) > 1_000_000 ||
                kotlin.math.abs(y) > 1_000_000
        )
            return
        peer.lastCursorAt = now
        audience(who.boardId)
            .filter { it !== peer }
            .forEach { send(it, mapOf("type" to "cursor", "id" to who.id, "x" to x, "y" to y)) }
    }

    fun remove(session: Session) {
        val peer = peers.remove(session.id) ?: return
        capacity.release()
        val id = peer.participant?.boardId ?: return
        synchronized(lock(id)) { if (audience(id).isEmpty()) modes.remove(id) else presence(id) }
    }

    fun disconnectGuests(id: UUID) =
        synchronized(lock(id)) {
            audience(id)
                .filter { it.participant?.role == "guest" }
                .forEach { it.close(1008, "Access revoked") }
        }

    private fun sweep() {
        for (peer in peers.values) {
            try {
                val now = System.currentTimeMillis()
                if (now >= peer.authExpiresAt) peer.close(1008, "Login expired")
                else if (peer.participant == null && now - peer.openedAt > 10_000)
                    peer.close(1008, "Authentication timeout")
                else if (peer.participant != null && now - peer.lastAuthAt > 30_000) {
                    store.authenticate(peer.participant!!.boardId, peer.token, peer.subject)
                    peer.lastAuthAt = now
                }
            } catch (_: ClientException) {
                peer.close(1008, "Session expired")
            } catch (error: Exception) {
                log.errorf("Session validation failed exception=%s", error.javaClass.simpleName)
                peer.close(1011, "Session validation unavailable")
            }
        }
    }

    @PreDestroy
    fun shutdown() {
        sweeper.shutdownNow()
        peers.values.forEach { it.close(1012, "Service restart") }
    }
}

@ServerEndpoint(value = "/ws/boards/{boardId}", configurator = BoardEndpointConfigurator::class)
@ApplicationScoped
class BoardSocket @Inject constructor(private val hub: RoomHub) {
    @OnOpen fun open(session: Session) = hub.open(session)

    @OnMessage fun message(text: String, session: Session) = hub.message(session, text)

    @OnClose fun close(session: Session) = hub.remove(session)

    @OnError
    fun error(session: Session, error: Throwable) {
        hub.remove(session)
        try {
            if (session.isOpen)
                session.close(
                    CloseReason(CloseReason.CloseCodes.UNEXPECTED_CONDITION, "Socket error")
                )
        } catch (_: Exception) {}
    }
}
