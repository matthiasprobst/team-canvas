package dev.teamcanvas

import jakarta.inject.Inject
import jakarta.ws.rs.*
import jakarta.ws.rs.core.Context
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.SecurityContext
import java.util.UUID

@Path("/api/boards/{id}/assistant")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
class AssistantResource @Inject constructor(private val service: AssistantService, private val chat: AssistantChat, private val limits: RequestLimits) {
    @Context lateinit var security: SecurityContext
    @HeaderParam("X-Draft-Capability") var capability: String? = null
    private fun identity() = loginIdentity(security.userPrincipal)

    @GET
    fun inspect(@PathParam("id") id: UUID, @QueryParam("pageId") pageId: UUID?) = mapOf("configured" to chat.configured(), "canvas" to service.inspect(identity(), id, pageId, capability).canvas)

    @POST
    fun chat(@PathParam("id") id: UUID, body: AssistantChatRequest): AssistantReply {
        val who = identity()
        limits.require("assistant:${Security.hash(who.issuer + who.subject)}", 20, 60_000)
        return chat.chat(who, id, body, capability)
    }

    @GET @Path("/proposals")
    fun proposals(@PathParam("id") id: UUID, @QueryParam("pageId") pageId: UUID?) = service.proposals(identity(), id, pageId, capability)

    @DELETE @Path("/proposals/{proposalId}")
    fun dismiss(@PathParam("id") id: UUID, @PathParam("proposalId") proposalId: UUID) {
        service.dismiss(identity(), id, proposalId, capability)
    }
}
