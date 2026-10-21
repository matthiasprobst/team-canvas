package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.Connection
import java.util.Optional
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.eclipse.microprofile.config.inject.ConfigProperty

@ApplicationScoped
class IdentityBlocks @Inject constructor(
    @ConfigProperty(name = "team-canvas.identity-blocking-secret", defaultValue = "development-only-identity-blocking-secret")
    private val secret: String = "development-only-identity-blocking-secret",
    @ConfigProperty(name = "team-canvas.identity-blocking-previous-secrets")
    private val previous: Optional<String> = Optional.empty(),
) {
    private fun digest(key: String, value: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(UTF_8), "HmacSHA256"))
        return mac.doFinal(value.toByteArray(UTF_8)).joinToString("") { "%02x".format(it) }
    }
    private fun identity(issuer: String, subject: String) = "identity\n$issuer\n$subject"
    fun lock(c: Connection, issuer: String, subject: String) {
        c.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", digest(secret, identity(issuer, subject))) { it.next() }
    }
    fun requireAllowed(c: Connection, issuer: String, subject: String) {
        val keys = listOf(secret) + previous.orElse("").split(',').filter { it.isNotBlank() }
        if (keys.any { key -> c.query("SELECT 1 FROM blocked_identities WHERE fingerprint=?", digest(key, identity(issuer, subject))) { it.next() } })
            throw ClientException("unauthorized", "This account no longer has application access.")
    }
    fun block(c: Connection, issuer: String, subject: String) {
        c.update("INSERT INTO blocked_identities(fingerprint) VALUES(?) ON CONFLICT DO NOTHING", digest(secret, identity(issuer, subject)))
    }
    fun impact(value: String): String = digest(secret, "impact\n$value")
}
