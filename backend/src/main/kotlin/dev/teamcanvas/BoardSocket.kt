package dev.teamcanvas

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import io.micrometer.core.instrument.MeterRegistry
import io.quarkus.websockets.client.runtime.WebSocketPrincipal
import jakarta.annotation.PreDestroy
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.inject.spi.CDI
import jakarta.inject.Inject
import jakarta.websocket.*
import jakarta.websocket.server.ServerEndpoint
import jakarta.websocket.server.ServerEndpointConfig
import java.security.Principal
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

/** Quarkus wraps the identity validated during the HTTP upgrade in a WebSocket principal. */
internal fun webSocketPrincipal(principal: Principal?): JsonWebToken {
    val authenticated =
        if (principal is WebSocketPrincipal) principal.securityIdentity.principal else principal
    return authenticated as? JsonWebToken
        ?: throw ClientException("unauthorized", "Please sign in.")
}

@ApplicationScoped
class RoomHub
@Inject
constructor(
    private val store: BoardStore,
    private val rounds: RoundService,
    private val pages: CanvasPageService,
    private val json: ObjectMapper,
    private val access: CanvasAccess,
    private val limits: RequestLimits,
    private val writer: SingleWriterGuard,
    private val metrics: MeterRegistry,
) {
    private val log = Logger.getLogger(RoomHub::class.java)
    private val peers = ConcurrentHashMap<String, Peer>()
    // Fixed stripes avoid retaining locks for arbitrary or abandoned board IDs.
    private val locks = Array(256) { Any() }
    private val modes = ConcurrentHashMap<UUID, String>()
    private val capacity = Semaphore(BoardLimits.CONNECTIONS)
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

    private fun send(peer: Peer, event: ServerEvent) = peer.send(json.writeValueAsString(event))

    @Synchronized
    fun open(session: Session) {
        if (!capacity.tryAcquire()) {
            session.close(
                CloseReason(CloseReason.CloseCodes.getCloseCode(1013), "Server connection limit")
            )
            return
        }
        try {
            val jwt = webSocketPrincipal(session.userPrincipal)
            val identity = loginIdentity(jwt)
            if (
                peers.values.count {
                    it.identity.issuer == identity.issuer && it.identity.subject == identity.subject
                } >= BoardLimits.CONNECTIONS_PER_ACCOUNT
            )
                throw ClientException("rate_limit", "Too many connections for this account.")
            val expiresAt = jwt.expirationTime * 1000
            session.maxTextMessageBufferSize = 4096
            session.maxIdleTimeout = 30 * 60_000L
            session.asyncRemote.sendTimeout = 5000
            peers[session.id] = Peer(session, identity, expiresAt)
        } catch (error: Exception) {
            capacity.release()
            log.warnf(
                "WebSocket open rejected code=%s exception=%s principalType=%s",
                (error as? ClientException)?.code ?: "internal_error",
                error.javaClass.simpleName,
                session.userPrincipal?.javaClass?.name ?: "none",
            )
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
                throw ClientException("login_expired", "Your sign-in session expired. Reconnecting…")
            limits.require("socket:${session.id}", 60)
            val bytes = text.toByteArray(Charsets.UTF_8).size
            if (bytes > BoardLimits.MESSAGE_BYTES) throw ClientException("too_large", "Message too large.")
            val packet = SocketCommandCodec.parse(text, json)
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
                    if (packet.path("protocolVersion").asInt() != 2)
                        throw ClientException("protocol_version", "Reload this page to update the collaboration client.")
                    if (peer.participant != null)
                        throw ClientException("invalid_state", "Already signed in.")
                    val token = packet.path("token").asText("")
                    val who = access.authenticate(boardId, token, peer.identity)
                    if (audience(boardId).size >= BoardLimits.CONNECTIONS_PER_BOARD)
                        throw ClientException(
                            "room_full",
                            "A canvas supports at most 10 active connections.",
                        )
                    peer.participant = who
                    peer.token = token
                    peer.lastAuthAt = System.currentTimeMillis()
                    session.maxTextMessageBufferSize = BoardLimits.MESSAGE_BYTES
                    snapshot(peer)
                    presence(boardId)
                    return@synchronized
                }
                val who =
                    peer.participant
                        ?: throw ClientException("unauthorized", "Please sign in first.")
                if (type == "ping") {
                    send(peer, PongEvent())
                    return@synchronized
                }
                if (type == "cursor") {
                    cursor(peer, packet)
                    return@synchronized
                }
                access.authenticate(boardId, peer.token, peer.identity)
                peer.lastAuthAt = System.currentTimeMillis()
                if (type == "draft") {
                    limits.require("draft:${session.id}", 5)
                    val key = packet.path("capability").asText()
                    val current = store.snapshot(who).board
                    if (current.mode != "poker" || packet.path("roundId").asText() != current.roundId.toString())
                        throw ClientException("stale_round", "Poker changed. Reconnect to recover your draft.")
                    val authorized = who.copy(draftKey = key)
                    DraftCapabilities.hash(authorized, current.roundId)
                    peer.participant = authorized
                    snapshot(peer)
                    return@synchronized
                }
                if (type == "resync") {
                    val now = System.currentTimeMillis()
                    if (now - peer.lastResyncAt < 2000)
                        throw ClientException("rate_limit", "Please wait a moment.")
                    peer.lastResyncAt = now
                    snapshot(peer)
                    return@synchronized
                }
                limits.require("writes:${session.id}", 20)
                val command = SocketCommandCodec.mutation(packet)
                val context = command.context
                val result = when (command) {
                    is PatchCommand -> {
                        val patch = store.patch(who, context, command.elements, command.files)
                        if (!patch.result.duplicate) {
                            val event = PatchEvent(
                                context.commandId, patch.result.ack.revision,
                                patch.scope, command.elements, command.files.keys.toList(),
                            )
                            audience(boardId)
                                .filter { patch.scope == "public" || (who.draftKey != null && it.participant?.draftKey == who.draftKey) }
                                .forEach { send(it, event) }
                        }
                        patch.result
                    }
                    is StartRoundCommand -> rounds.start(who, context)
                    is StopRoundCommand -> rounds.stop(who, context)
                    is CreatePageCommand -> pages.create(who, context, command.copyCurrent, command.includePoker)
                    is SelectPageCommand -> pages.select(who, context, command.targetPageId)
                }
                send(peer, result.ack)
                metrics.counter("team.canvas.commands", "type", type).increment()
                // A retried control command still needs its state-completion barrier.
                if (result.duplicate && type != "patch") snapshot(peer)
                if (!result.duplicate && type != "patch") {
                    if (result.transitioned) audience(boardId).forEach { snapshot(it) }
                    else
                        audience(boardId).forEach {
                            val data = store.roundState(it.participant!!)
                            send(
                                it,
                                RoundEvent(data.first, data.second),
                            )
                        }
                    presence(boardId)
                }
            }
        } catch (error: ClientException) {
            metrics.counter("team.canvas.rejections", "code", error.code).increment()
            send(
                peer,
                ErrorEvent(commandId, error.code, error.message),
            )
            if (error.code in setOf("unauthorized", "login_expired", "room_full", "protocol_version"))
                peer.closeAfterDrain(1008, error.code)
            if (error.code == "unavailable" || (error.code == "rate_limit" && commandId == null))
                peer.closeAfterDrain(1013, error.code)
        } catch (_: IllegalArgumentException) {
            send(
                peer,
                ErrorEvent(commandId, "bad_request", "Invalid message."),
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
                            "stop_round",
                            "create_page",
                            "select_page",
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

    private fun snapshot(peer: Peer) {
        val data = store.snapshot(peer.participant!!)
        modes[data.board.id] = data.board.mode
        send(peer, SnapshotEvent(data))
    }

    private fun presence(id: UUID) {
        val participants =
            audience(id)
                .mapNotNull { it.participant }
                .distinctBy { it.id }
                .map { PresenceMember(it.id, it.name, it.role) }
        audience(id).forEach {
            send(it, PresenceEvent(participants, audience(id).size))
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
            .forEach { send(it, CursorEvent(who.id, x, y)) }
    }

    fun remove(session: Session) {
        val peer = peers.remove(session.id) ?: return
        capacity.release()
        val id = peer.participant?.boardId ?: return
        synchronized(lock(id)) { if (audience(id).isEmpty()) modes.remove(id) else presence(id) }
    }

    fun disconnectLogin(identity: LoginIdentity) {
        peers.values
            .filter {
                it.identity.issuer == identity.issuer &&
                    it.identity.subject == identity.subject &&
                    it.identity.sid == identity.sid
            }
            .forEach { it.close(1008, "Signed out") }
    }

    fun disconnectAccount(issuer: String, subject: String) {
        peers.values.filter { it.identity.issuer == issuer && it.identity.subject == subject }
            .forEach { it.close(1008, "Account access removed") }
    }

    fun ownershipChanged(id: UUID) = synchronized(lock(id)) {
        audience(id).forEach { it.close(1008, "Ownership changed. Reopen this canvas.") }
    }

    fun deletedByAdmin(id: UUID) = delete(id) { }

    fun rename(id: UUID, action: () -> String): String =
        synchronized(lock(id)) {
            val name = action()
            audience(id).forEach { send(it, MetadataEvent(name)) }
            name
        }

    fun <T> refresh(id: UUID, action: () -> T): T = synchronized(lock(id)) {
        val result = action()
        audience(id).forEach { snapshot(it) }
        result
    }

    fun delete(id: UUID, action: () -> Unit) =
        synchronized(lock(id)) {
            action()
            modes.remove(id)
            audience(id).forEach {
                send(it, ErrorEvent(null, "canvas_deleted", "This canvas was deleted by its owner."))
                it.closeAfterDrain(1008, "Canvas deleted")
            }
        }

    fun revoke(id: UUID, revokeMembers: Boolean, action: () -> Unit) =
        synchronized(lock(id)) {
            action()
            if (revokeMembers) disconnectGuests(id)
        }

    fun disconnectGuests(id: UUID) =
        synchronized(lock(id)) {
            audience(id)
                .filter { it.participant?.role == "guest" }
                .forEach { it.close(1008, "Access revoked") }
        }

    fun memberAccess(id: UUID, memberId: UUID, revoked: Boolean, action: () -> Unit) =
        synchronized(lock(id)) {
            action()
            if (revoked) audience(id)
                .filter { it.participant?.id == memberId }
                .forEach { it.close(1008, "Access revoked") }
        }

    private fun sweep() {
        for (peer in peers.values) {
            try {
                val now = System.currentTimeMillis()
                if (now >= peer.authExpiresAt) peer.close(1008, "login_expired")
                else if (peer.participant == null && now - peer.openedAt > 10_000)
                    peer.close(1008, "Authentication timeout")
                else if (peer.participant != null && now - peer.lastAuthAt > 30_000) {
                    access.authenticate(peer.participant!!.boardId, peer.token, peer.identity)
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
