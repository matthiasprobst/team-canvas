package dev.teamcanvas

import java.util.ArrayDeque

/** Serializes async delivery and counts the in-flight message against both budgets. */
internal class OutboundQueue(
    private val deliver: (String, (Boolean) -> Unit) -> Unit,
    private val close: (Int, String) -> Unit,
    private val maxMessages: Int = BoardLimits.OUTGOING_MESSAGES,
    private val maxBytes: Long = BoardLimits.OUTGOING_BYTES,
) {
    private data class Message(val text: String, val bytes: Int)
    private val messages = ArrayDeque<Message>()
    private var bytes = 0L
    private var stopped = false
    private var closing: Pair<Int, String>? = null

    @Synchronized
    fun send(text: String) {
        if (stopped || closing != null) return
        val message = Message(text, text.toByteArray(Charsets.UTF_8).size)
        if (messages.size >= maxMessages || bytes + message.bytes > maxBytes) {
            fail(1013, "Slow reader")
            return
        }
        messages.addLast(message)
        bytes += message.bytes
        if (messages.size == 1) sendNext()
    }

    private fun sendNext() {
        val message = messages.peekFirst() ?: return
        try {
            deliver(message.text) { delivered ->
                synchronized(this) {
                    if (stopped) return@synchronized
                    if (!delivered) {
                        fail(1011, "Delivery failed")
                        return@synchronized
                    }
                    messages.removeFirst().also { bytes -= it.bytes }
                    if (messages.isNotEmpty()) sendNext()
                    else closing?.let { fail(it.first, it.second) }
                }
            }
        } catch (_: Exception) {
            fail(1011, "Delivery failed")
        }
    }

    @Synchronized
    fun closeAfterDrain(code: Int, reason: String) {
        if (stopped || closing != null) return
        closing = code to reason
        if (messages.isEmpty()) fail(code, reason)
    }

    private fun fail(code: Int, reason: String) {
        if (stopped) return
        stop()
        close(code, reason)
    }

    @Synchronized
    fun stop() {
        stopped = true
        messages.clear()
        bytes = 0
    }
}
