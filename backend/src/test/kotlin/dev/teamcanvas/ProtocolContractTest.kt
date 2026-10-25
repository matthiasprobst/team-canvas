package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ProtocolContractTest {
    private val json = jacksonObjectMapper()
    private fun id(number: Int) = UUID.fromString("00000000-0000-4000-8000-${number.toString().padStart(12, '0')}")

    @Test
    fun `backend event serialization matches the fixtures accepted by the frontend decoder`() {
        val board = BoardState(id(1), "Test", "standard", null, 0, 0, id(3))
        val poker = board.copy(mode = "poker", roundId = id(4), epoch = 1)
        val round = RoundState(id(4))
        fun snapshot(state: BoardState, roundState: RoundState?) = SceneSnapshot(
            state, roundState, emptyList(), emptyList(), emptyList(), id(2), "host",
            listOf(CanvasSheet(id(3), 0)), emptyList(),
        )
        val events = listOf<ServerEvent>(
            SnapshotEvent(snapshot(board, null)), SnapshotEvent(snapshot(poker, round)),
            PatchEvent(id(5), 1, "private", emptyList(), emptyList()),
            CommandAck(commandId = id(5), revision = 1), RoundEvent(poker, round),
            MetadataEvent("Renamed"), PresenceEvent(listOf(PresenceMember(id(2), "Me", "host")), 1, 30),
            CursorEvent(id(2), 1.0, 2.0), PongEvent(), ErrorEvent(null, "unauthorized", "Please sign in."),
        )
        val expected = json.readTree(Files.readString(Path.of("../tests/fixtures/protocol.json")))
        assertEquals(expected, json.readTree(json.writeValueAsString(events)))
    }
}
