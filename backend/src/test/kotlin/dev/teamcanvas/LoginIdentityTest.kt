package dev.teamcanvas

import io.quarkus.security.runtime.QuarkusSecurityIdentity
import io.quarkus.websockets.client.runtime.WebSocketPrincipal
import java.lang.reflect.Proxy
import java.security.Principal
import org.eclipse.microprofile.jwt.JsonWebToken
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class LoginIdentityTest {
    private fun jwt(
        issuer: String? = "https://company.test/realms/staff",
        subject: String? = "employee",
        sid: String? = "login",
        expires: Long = System.currentTimeMillis() / 1000 + 60,
    ): JsonWebToken =
        Proxy.newProxyInstance(
            JsonWebToken::class.java.classLoader,
            arrayOf(JsonWebToken::class.java),
        ) { _, method, args ->
            when (method.name) {
                "getIssuer" -> issuer
                "getSubject" -> subject
                "getExpirationTime" -> expires
                "getClaim" ->
                    when (args[0]) {
                        "sid" -> sid
                        "name" -> "Alice"
                        else -> null
                    }
                else -> null
            }
        } as JsonWebToken

    @Test
    fun `verified issuer subject and login are all required`() {
        assertEquals(
            LoginIdentity("https://company.test/realms/staff", "employee", "login", "Alice"),
            loginIdentity(jwt()),
        )
        for (principal in
            listOf(jwt(issuer = null), jwt(subject = ""), jwt(sid = null), jwt(expires = 1))) {
            assertEquals(
                "unauthorized",
                assertThrows(ClientException::class.java) { loginIdentity(principal) }.code,
            )
        }
    }

    private fun socketPrincipal(principal: Principal): WebSocketPrincipal =
        WebSocketPrincipal(QuarkusSecurityIdentity.builder().setPrincipal(principal).build())

    @Test
    fun `websocket upgrade preserves the verified login and token expiry`() {
        val token = jwt()
        val unwrapped = webSocketPrincipal(socketPrincipal(token))
        assertSame(token, unwrapped)
        assertEquals(loginIdentity(token), loginIdentity(unwrapped))
        assertEquals(token.expirationTime, unwrapped.expirationTime)
    }

    @Test
    fun `websocket identities still require a valid JWT login`() {
        for (principal in
            listOf(null, Principal { "employee" }, socketPrincipal(Principal { "employee" }))) {
            assertEquals(
                "unauthorized",
                assertThrows(ClientException::class.java) { webSocketPrincipal(principal) }.code,
            )
        }
        for (token in listOf(jwt(issuer = null), jwt(subject = ""), jwt(sid = null), jwt(expires = 1))) {
            assertEquals(
                "unauthorized",
                assertThrows(ClientException::class.java) {
                        loginIdentity(webSocketPrincipal(socketPrincipal(token)))
                    }
                    .code,
            )
        }
    }

    @Test
    fun `canvas names are trimmed bounded and reject controls`() {
        assertEquals("Planning", canvasName(" Planning "))
        for (name in listOf(" ", "x".repeat(121), "Title\nSubtitle")) {
            assertEquals(
                "bad_request",
                assertThrows(ClientException::class.java) { canvasName(name) }.code,
            )
        }
    }
}
