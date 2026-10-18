package dev.teamcanvas

import jakarta.inject.Inject
import jakarta.ws.rs.*
import jakarta.ws.rs.core.Context
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response
import jakarta.ws.rs.core.SecurityContext
import java.net.URI
import java.util.UUID

@Path("/api/boards")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
class BoardResource
@Inject
constructor(
    private val store: BoardStore,
    private val access: AccessPolicy,
    private val hub: RoomHub,
) {
    @Context lateinit var security: SecurityContext

    @POST
    fun create(body: CreateBoardRequest): CreatedBoard =
        store.create(body.name, access.subject(security.userPrincipal))

    @POST
    @Path("/{id}/join")
    fun join(@PathParam("id") raw: String, body: JoinRequest): JoinedBoard =
        store.join(boardId(raw), body, access.subject(security.userPrincipal))

    @GET
    @Path("/{id}/assets/{assetId}")
    fun asset(
        @PathParam("id") raw: String,
        @PathParam("assetId") assetId: String,
        @HeaderParam("X-Board-Token") token: String?,
    ): Response {
        val who =
            store.authenticate(boardId(raw), token ?: "", access.subject(security.userPrincipal))
        return Response.ok(store.asset(who, assetId))
            .header("Cache-Control", "private, no-store")
            .build()
    }

    data class RotateInvitationRequest(val token: String, val revokeGuests: Boolean = false)

    @POST
    @Path("/{id}/invitations")
    fun rotate(@PathParam("id") raw: String, body: RotateInvitationRequest): Map<String, String> {
        val who =
            store.authenticate(boardId(raw), body.token, access.subject(security.userPrincipal))
        val key = store.rotateInvitation(who, body.revokeGuests)
        if (body.revokeGuests) hub.disconnectGuests(who.boardId)
        return mapOf("inviteKey" to key)
    }

    private fun boardId(value: String): UUID =
        try {
            UUID.fromString(value)
        } catch (_: IllegalArgumentException) {
            throw ClientException("bad_request", "Ungültige Board-ID")
        }
}

@Path("/api/login")
class LoginResource {
    @GET
    fun login(@QueryParam("return") target: String?): Response {
        val destination =
            target?.takeIf { it == "/" || Regex("^/b/[a-fA-F0-9-]{36}$").matches(it) } ?: "/"
        return Response.seeOther(URI.create(destination)).build()
    }
}

@Path("/api/session")
class SessionResource @Inject constructor(private val access: AccessPolicy) {
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    fun session(@Context security: SecurityContext): Map<String, Boolean> =
        mapOf(
            "authenticated" to (access.subject(security.userPrincipal) != null),
            "authRequired" to access.authRequired,
        )
}

@jakarta.ws.rs.ext.Provider
class ClientErrorMapper : jakarta.ws.rs.ext.ExceptionMapper<ClientException> {
    override fun toResponse(error: ClientException): Response =
        Response.status(
                when (error.code) {
                    "not_found" -> 404
                    "unauthorized" -> 401
                    "forbidden",
                    "locked" -> 403
                    "rate_limit",
                    "daily_limit" -> 429
                    "unavailable" -> 503
                    else -> 400
                }
            )
            .entity(mapOf("code" to error.code, "message" to error.message))
            .type(MediaType.APPLICATION_JSON)
            .header("Cache-Control", "no-store")
            .build()
}
