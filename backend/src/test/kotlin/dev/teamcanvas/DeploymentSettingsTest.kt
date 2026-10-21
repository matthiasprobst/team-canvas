package dev.teamcanvas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DeploymentSettingsTest {
    private fun production() = DeploymentSettings().apply {
        production = true
        issuer = "https://identity.example/realm"
        origins = "https://canvas.example"
        secret = "a".repeat(48)
        secureCookies = true
        autoMigrate = false
    }

    @Test fun `production rejects unsafe cookies automatic migrations and HTTP origins`() {
        production().validate()
        assertThrows(IllegalArgumentException::class.java) { production().apply { secureCookies = false }.validate() }
        assertThrows(IllegalArgumentException::class.java) { production().apply { autoMigrate = true }.validate() }
        assertThrows(IllegalArgumentException::class.java) { production().apply { origins = "http://canvas.example" }.validate() }
        assertThrows(IllegalArgumentException::class.java) { production().apply { secret = "development-only-secret" }.validate() }
    }
}
