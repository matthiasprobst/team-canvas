package dev.teamcanvas

import java.nio.ByteBuffer
import java.util.Base64
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ImageValidationTest {
    private fun png() =
        Base64.getDecoder()
            .decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg=="
            )

    @Test
    fun `small real PNG metadata is accepted without decoding a bitmap`() {
        ImageValidation.requireSafeDimensions(png(), "image/png")
    }

    @Test
    fun `oversized dimensions are rejected even in a tiny encoded file`() {
        val image = png()
        ByteBuffer.wrap(image, 16, 8).putInt(100_000).putInt(100_000)
        assertThrows(ClientException::class.java) {
            ImageValidation.requireSafeDimensions(image, "image/png")
        }
    }

    @Test
    fun `a GIF canvas cannot exceed the bitmap budget`() {
        val image = "GIF89a".toByteArray() + byteArrayOf(-1, -1, -1, -1, 0, 0, 0)
        assertThrows(ClientException::class.java) {
            ImageValidation.requireSafeDimensions(image, "image/gif")
        }
    }

    @Test
    fun `a WebP extended header without a bounded image bitstream is rejected`() {
        val image = ByteArray(30)
        "RIFF".toByteArray().copyInto(image, 0)
        image[4] = 22
        "WEBPVP8X".toByteArray().copyInto(image, 8)
        image[16] = 10
        assertThrows(ClientException::class.java) {
            ImageValidation.requireSafeDimensions(image, "image/webp")
        }
    }
}
