package dev.teamcanvas

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class AssistantSkillsTest {
    @Test fun `explicit commands pick one skill and preserve user arguments`() {
        for (skill in AssistantSkills.all) {
            val request = AssistantSkills.route("${skill.command.uppercase()} Preserve Case")
            assertEquals(skill, request.skill)
            assertEquals("Preserve Case", request.task)
        }
        assertNull(AssistantSkills.route("/layouting").skill)
        assertEquals("flow", AssistantSkills.route("/layout").layoutMode)
        assertEquals("grid", AssistantSkills.route("/layout GRID").layoutMode)
        assertNull(AssistantSkills.route("/layout billing notes only").layoutMode)
    }

    @Test fun `clear requests use a skill and mixed requests keep general chat`() {
        assertEquals("ticket", AssistantSkills.route("Turn these notes into a feature ticket").skill?.name)
        assertEquals("relations", AssistantSkills.route("Which notes should be connected?").skill?.name)
        assertNull(AssistantSkills.route("Arrange the objects and create a ticket").skill)
        assertNull(AssistantSkills.route("How do I change the font?").skill)
        assertEquals("refine", AssistantSkills.route("Managers approve the request.", "refine").skill?.name)
        assertEquals("layout", AssistantSkills.route("Arrange those notes", "refine").skill?.name)
    }

    @Test fun `only simple page or selection counts use the exact count path`() {
        assertTrue(AssistantSkills.route("/count").count)
        assertTrue(AssistantSkills.route("How many notes are on this page?").count)
        assertFalse(AssistantSkills.route("How many notes mention billing?").count)
        assertFalse(AssistantSkills.route("How many notes are on this page and which are duplicates?").count)
    }

    @Test fun `flow leaves extra column space for longer connection labels`() {
        val json = jacksonObjectMapper()
        val board = BoardState(UUID.randomUUID(), "Skills", "standard", null, 0, 0, UUID.randomUUID())
        val source = CanvasObject("a", "note", "Research", 0.0, 0.0, 220.0, 170.0)
        val target = source.copy(id = "b", text = "Design")
        val edge = source.copy(id = "edge", kind = "connection", text = "validates assumptions before implementation", sourceId = "a", targetId = "b")
        val canvas = AssistantCanvas(board, emptyList(), "shared", CanvasFacts(3, 2, 0, 0, 1, 0, 3), listOf(source, target, edge))
        val actions = json.readTree("""[{"type":"arrange_objects","ids":["a","b"],"layout":"flow"}]""")
        val moved = AssistantLayout.expand(actions, canvas, json)
        assertTrue(moved[1].path("x").asDouble() - source.width > 120)
    }
}
