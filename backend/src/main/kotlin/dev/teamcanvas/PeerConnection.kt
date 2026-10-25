package dev.teamcanvas

import jakarta.websocket.CloseReason
import jakarta.websocket.Session

/** One ordered, bounded send queue per socket; a slow reader cannot accumulate unlimited data. */
internal class Peer(val session: Session, val identity: LoginIdentity, val authExpiresAt: Long) {
    @Volatile private var closed = false
    @Volatile var participant: Participant? = null
    var token: String = ""
    var lastCursorAt = 0L
    var lastResyncAt = 0L
    @Volatile var lastAuthAt = 0L
    val openedAt = System.currentTimeMillis()
    private val outbound = OutboundQueue(
        deliver = { text, completed -> session.asyncRemote.sendText(text) { completed(it.isOK) } },
        close = { code, reason -> java.util.concurrent.CompletableFuture.runAsync { close(code, reason) } },
    )

    fun send(text: String) {
        if (!closed && session.isOpen) outbound.send(text)
    }

    fun closeAfterDrain(code: Int, reason: String) = outbound.closeAfterDrain(code, reason)

    fun close(code: Int, reason: String) {
        closed = true
        outbound.stop()
        try {
            session.close(CloseReason(CloseReason.CloseCodes.getCloseCode(code), reason))
        } catch (_: Exception) {}
    }
}
