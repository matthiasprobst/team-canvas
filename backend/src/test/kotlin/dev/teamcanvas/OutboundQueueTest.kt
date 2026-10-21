package dev.teamcanvas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class OutboundQueueTest {
    private class Transport(maxMessages: Int = 64, maxBytes: Long = 8_000_000) {
        val sent = mutableListOf<String>()
        val callbacks = ArrayDeque<(Boolean) -> Unit>()
        val closed = mutableListOf<Pair<Int, String>>()
        val queue = OutboundQueue(
            { text, completed -> sent.add(text); callbacks.addLast(completed) },
            { code, reason -> closed.add(code to reason) },
            maxMessages, maxBytes,
        )
        fun complete(delivered: Boolean = true) = callbacks.removeFirst()(delivered)
    }

    @Test
    fun `messages are delivered in order and close waits for the final message`() {
        val transport = Transport()
        transport.queue.send("ack")
        transport.queue.send("snapshot")
        transport.queue.closeAfterDrain(1008, "Closed")
        assertEquals(listOf("ack"), transport.sent)
        assertTrue(transport.closed.isEmpty())
        transport.complete()
        assertEquals(listOf("ack", "snapshot"), transport.sent)
        assertTrue(transport.closed.isEmpty())
        transport.complete()
        assertEquals(listOf(1008 to "Closed"), transport.closed)
        transport.queue.send("late")
        assertEquals(2, transport.sent.size)
    }

    @Test
    fun `overflow includes the in-flight message and closes only once`() {
        val transport = Transport(maxMessages = 1)
        transport.queue.send("first")
        transport.queue.send("overflow")
        transport.queue.send("another")
        transport.complete()
        assertEquals(listOf(1013 to "Slow reader"), transport.closed)
        assertEquals(listOf("first"), transport.sent)
    }

    @Test
    fun `UTF-8 bytes determine the outgoing budget`() {
        val transport = Transport(maxBytes = 3)
        transport.queue.send("é")
        transport.queue.send("é")
        assertEquals(listOf(1013 to "Slow reader"), transport.closed)
    }

    @Test
    fun `failed delivery and thrown send close without delivering queued messages`() {
        val transport = Transport()
        transport.queue.send("first")
        transport.queue.send("second")
        transport.complete(false)
        assertEquals(listOf("first"), transport.sent)
        assertEquals(listOf(1011 to "Delivery failed"), transport.closed)
        var code = 0
        val queue = OutboundQueue({ _, _ -> throw IllegalStateException() }, { value, _ -> code = value })
        queue.send("first")
        assertEquals(1011, code)
    }

    @Test
    fun `stopping discards pending data and ignores late delivery callbacks`() {
        val transport = Transport()
        transport.queue.send("first")
        transport.queue.send("second")
        transport.queue.stop()
        transport.complete()
        assertEquals(listOf("first"), transport.sent)
        assertTrue(transport.closed.isEmpty())
    }
}
