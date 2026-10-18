package dev.teamcanvas

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

object Security {
    private val random = SecureRandom()

    fun token(): String =
        ByteArray(32).also(random::nextBytes).let {
            Base64.getUrlEncoder().withoutPadding().encodeToString(it)
        }

    fun hash(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(
            ""
        ) {
            "%02x".format(it)
        }

    fun equalHashes(a: String, b: String): Boolean =
        MessageDigest.isEqual(a.toByteArray(), b.toByteArray())
}
