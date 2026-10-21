package dev.teamcanvas

import jakarta.annotation.security.RolesAllowed
import jakarta.inject.Inject
import jakarta.ws.rs.*
import jakarta.ws.rs.core.Context
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response
import jakarta.ws.rs.core.SecurityContext
import java.util.UUID

@Path("/api/admin")
@RolesAllowed("team-canvas-admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
class AdminResource @Inject constructor(private val service: AdminService, private val accounts: Accounts, private val hub: RoomHub) {
    @Context lateinit var security: SecurityContext
    private fun actor() = accounts.current(loginIdentity(security.userPrincipal)).id
    private fun id(raw: String) = try { UUID.fromString(raw) } catch (_: IllegalArgumentException) { throw ClientException("bad_request", "Invalid identifier.") }
    @GET @Path("/offboarding-export")
    fun offboardingExport(): Response {
        actor()
        return Response.ok(service.offboardingExport()).header("Content-Disposition", "attachment; filename=team-canvas-offboarding.json").build()
    }
    @GET @Path("/users")
    fun users(@QueryParam("offset") @DefaultValue("0") offset: Int, @QueryParam("q") @DefaultValue("") q: String): AdminUsers {
        actor()
        return service.list(offset, q)
    }
    @GET @Path("/users/{id}/impact")
    fun impact(@PathParam("id") raw: String): UserImpact { actor(); return service.impact(id(raw)) }
    data class Action(val action: String = "", val impactToken: String = "", val confirmation: String = "")
    @POST @Path("/users/{id}/actions")
    fun action(@PathParam("id") raw: String, body: Action): LifecycleResult {
        val (result, affected) = service.change(actor(), id(raw), body.action, body.impactToken, body.confirmation, hub::disconnectAccount)
        if (body.action == "delete") affected.forEach(hub::deletedByAdmin)
        return result
    }
    data class Reassign(val targetUserId: UUID)
    @POST @Path("/canvases/{id}/owner")
    fun reassign(@PathParam("id") raw: String, body: Reassign): Response {
        val board = id(raw)
        service.reassign(actor(), board, body.targetUserId)
        hub.ownershipChanged(board)
        return Response.noContent().build()
    }
}
