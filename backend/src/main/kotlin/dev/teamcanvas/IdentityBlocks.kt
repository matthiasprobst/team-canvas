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
    private val secret: String,
    @ConfigProperty(name = "team-canvas.identity-blocking-previous-secrets")
    private val previous: Optional<String>,
) {
    constructor() : this("development-only-identity-blocking-secret", Optional.empty())
    private fun digest(key: String, value: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(UTF_8), "HmacSHA256"))
        return mac.doFinal(value.toByteArray(UTF_8)).joinToString("") { "%02x".format(it) }
    }
    fun keyId(key: String): String = Security.hash(key).take(16)
    fun configuredKeys(): List<String> = listOf(secret) + previous.orElse("").split(',').filter { it.isNotBlank() }
    fun fingerprint(key: String, issuer: String, subject: String): String = digest(key, identity(issuer, subject))
    private fun identity(issuer: String, subject: String) = "identity\n$issuer\n$subject"
    fun lock(c: Connection, issuer: String, subject: String) {
        c.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", digest(secret, identity(issuer, subject))) { it.next() }
    }
    fun requireAllowed(c: Connection, issuer: String, subject: String) {
        val keys = configuredKeys()
        if (keys.any { key -> c.query("SELECT 1 FROM blocked_identities WHERE fingerprint=?", digest(key, identity(issuer, subject))) { it.next() } })
            throw ClientException("unauthorized", "This account no longer has application access.")
    }
    fun block(c: Connection, issuer: String, subject: String, action: String) {
        require(action in setOf("anonymize", "delete"))
        c.update("INSERT INTO blocked_identities(fingerprint,key_id,action) VALUES(?,?,?) ON CONFLICT DO NOTHING", fingerprint(secret, issuer, subject), keyId(secret), action)
    }
    fun impact(value: String): String = digest(secret, "impact\n$value")
}
