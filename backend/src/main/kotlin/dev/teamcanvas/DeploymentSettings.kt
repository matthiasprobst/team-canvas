package dev.teamcanvas

import io.quarkus.runtime.Startup
import jakarta.annotation.PostConstruct
import jakarta.enterprise.context.ApplicationScoped
import org.eclipse.microprofile.config.inject.ConfigProperty

@Startup
@ApplicationScoped
class DeploymentSettings {
    @ConfigProperty(name = "team-canvas.production", defaultValue = "false")
    var production: Boolean = false
    @ConfigProperty(name = "quarkus.oidc.auth-server-url", defaultValue = "")
    lateinit var issuer: String
    @ConfigProperty(name = "quarkus.oidc.token-state-manager.encryption-secret", defaultValue = "")
    lateinit var secret: String
    @ConfigProperty(name = "team-canvas.allowed-origins", defaultValue = "")
    lateinit var origins: String
    @ConfigProperty(name = "quarkus.oidc.authentication.cookie-force-secure", defaultValue = "true")
    var secureCookies: Boolean = true
    @ConfigProperty(name = "quarkus.flyway.migrate-at-start", defaultValue = "true")
    var autoMigrate: Boolean = true

    @ConfigProperty(name = "team-canvas.identity-blocking-secret", defaultValue = "development-only-identity-blocking-secret")
    lateinit var blockingSecret: String

    @PostConstruct
    fun validate() {
        if (!production) return
        require(issuer.startsWith("https://") && origins.split(',').all { it.trim().startsWith("https://") }) {
            "Production issuer and allowed origins must use HTTPS"
        }
        require(listOf(secret, blockingSecret).all { value -> value.length >= 32 && listOf("development", "REPLACE").none { value.contains(it, true) } }) {
            "Production requires a persistent random session secret"
        }
        require(secureCookies && !autoMigrate) { "Production requires secure cookies and separate migrations" }
    }
}
