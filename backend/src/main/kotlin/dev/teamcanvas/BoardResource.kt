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
    private val access: CanvasAccess,
    private val catalog: CanvasCatalog,
    private val hub: RoomHub,
) {
    @Context lateinit var security: SecurityContext

    private fun identity() = loginIdentity(security.userPrincipal)

    @POST fun create(body: CreateBoardRequest): CreatedBoard = access.create(body.name, identity())

    @GET
    fun list(
        @QueryParam("filter") @DefaultValue("all") filter: String,
        @QueryParam("q") @DefaultValue("") query: String,
        @QueryParam("sort") @DefaultValue("recent") sort: String,
        @QueryParam("limit") @DefaultValue("24") limit: Int,
        @QueryParam("cursor") cursor: String?,
    ): CanvasPage = catalog.list(identity(), filter, query, sort, limit, cursor)

    @GET
    @Path("/tags/suggestions")
    fun tagSuggestions(): List<String> = catalog.tagSuggestions(identity())

    @PUT
    @Path("/{id}/tags")
    fun setTags(@PathParam("id") raw: String, body: CanvasTagsRequest): Response {
        catalog.setTags(boardId(raw), body.tags, identity())
        return Response.noContent().build()
    }

    @POST
    @Path("/{id}/join")
    fun join(@PathParam("id") raw: String, body: JoinRequest): JoinedBoard =
        access.join(boardId(raw), body, identity())

    @PATCH
    @Path("/{id}")
    fun rename(@PathParam("id") raw: String, body: CreateBoardRequest): Map<String, String> {
        val id = boardId(raw)
        return mapOf("name" to hub.rename(id) { catalog.rename(id, body.name, identity()) })
    }

    @DELETE
    @Path("/{id}")
    fun delete(@PathParam("id") raw: String): Response {
        val id = boardId(raw)
        hub.delete(id) { catalog.delete(id, identity()) }
        return Response.noContent().build()
    }

    @PUT
    @Path("/{id}/template")
    fun markTemplate(
        @PathParam("id") raw: String,
        body: TemplateVisibilityRequest,
    ): Response {
        catalog.markTemplate(boardId(raw), body.visibility, identity())
        return Response.noContent().build()
    }

    @DELETE
    @Path("/{id}/template")
    fun unmarkTemplate(@PathParam("id") raw: String): Response {
        catalog.unmarkTemplate(boardId(raw), identity())
        return Response.noContent().build()
    }

    @POST
    @Path("/{id}/start-template")
    fun startTemplate(@PathParam("id") raw: String, body: CreateBoardRequest): CreatedBoard =
        catalog.startTemplate(boardId(raw), body.name, identity())

    @GET
    @Path("/{id}/assets/{assetId}")
    fun asset(
        @PathParam("id") raw: String,
        @PathParam("assetId") assetId: String,
        @HeaderParam("X-Board-Token") token: String?,
    ): Response {
        val who = access.authenticate(boardId(raw), token ?: "", identity())
        return Response.ok(store.asset(who, assetId))
            .header("Cache-Control", "private, no-store")
            .build()
    }

    @POST
    @Path("/{id}/invitations")
    fun invite(@PathParam("id") raw: String): Map<String, String> =
        access.invite(boardId(raw), identity())

    @POST
    @Path("/{id}/invitations/preview")
    fun preview(@PathParam("id") raw: String, body: InvitationRequest): Map<String, String> =
        access.preview(boardId(raw), body.inviteKey, identity())

    data class RevokeRequest(val revokeMembers: Boolean = false)

    @POST
    @Path("/{id}/invitations/revoke")
    fun revoke(@PathParam("id") raw: String, body: RevokeRequest): Response {
        val id = boardId(raw)
        hub.revoke(id, body.revokeMembers) { access.revoke(id, identity(), body.revokeMembers) }
        return Response.noContent().build()
    }

    private fun boardId(value: String): UUID =
        try {
            UUID.fromString(value)
        } catch (_: IllegalArgumentException) {
            throw ClientException("bad_request", "Invalid canvas ID.")
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

@Path("/api/me")
class SessionResource @Inject constructor(private val accounts: Accounts) {
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    fun me(@Context security: SecurityContext): Account =
        accounts.current(loginIdentity(security.userPrincipal))
}

@Path("/api/logout")
class LogoutResource @Inject constructor(private val accounts: Accounts, private val hub: RoomHub) {
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    fun logout(@Context security: SecurityContext): Map<String, String> {
        val identity = loginIdentity(security.userPrincipal)
        hub.disconnectLogin(identity)
        accounts.logout(identity)
        return mapOf("redirect" to "/api/oidc/logout")
    }
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

@jakarta.ws.rs.ext.Provider
class PrivateResponseFilter : jakarta.ws.rs.container.ContainerResponseFilter {
    override fun filter(
        request: jakarta.ws.rs.container.ContainerRequestContext,
        response: jakarta.ws.rs.container.ContainerResponseContext,
    ) {
        if (request.uriInfo.path.trimStart('/').startsWith("api/"))
            response.headers.putSingle("Cache-Control", "no-store")
    }
}
