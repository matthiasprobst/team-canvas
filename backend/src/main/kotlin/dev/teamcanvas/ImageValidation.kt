package dev.teamcanvas

import java.io.ByteArrayInputStream
import javax.imageio.ImageIO
import javax.imageio.stream.MemoryCacheImageInputStream

/** Read bounded image metadata without allocating a decoded bitmap. */
object ImageValidation {
    private const val MAX_PIXELS = 16_000_000L
    private const val MAX_DIMENSION = 8192

    fun requireSafeDimensions(bytes: ByteArray, mime: String) {
        try {
            if (mime == "image/webp") {
                validateWebP(bytes)
                return
            }
            if (mime == "image/png") rejectAnimatedPng(bytes)
            if (mime == "image/gif") {
                if (bytes.size < 10) invalid()
                checkSize(
                    (bytes[6].toInt() and 255) or ((bytes[7].toInt() and 255) shl 8),
                    (bytes[8].toInt() and 255) or ((bytes[9].toInt() and 255) shl 8),
                )
            }
            MemoryCacheImageInputStream(ByteArrayInputStream(bytes)).use { input ->
                val readers = ImageIO.getImageReaders(input)
                if (!readers.hasNext()) invalid()
                val reader = readers.next()
                try {
                    reader.input = input
                    val count = if (mime == "image/gif") reader.getNumImages(true) else 1
                    if (count !in 1..100) invalid()
                    var pixels = 0L
                    val canvasPixels =
                        if (mime == "image/gif")
                            ((bytes[6].toInt() and 255) or ((bytes[7].toInt() and 255) shl 8))
                                .toLong() *
                                ((bytes[8].toInt() and 255) or ((bytes[9].toInt() and 255) shl 8))
                        else 0L
                    if (canvasPixels * count > MAX_PIXELS) invalid()
                    for (index in 0 until count) {
                        val width = reader.getWidth(index)
                        val height = reader.getHeight(index)
                        checkSize(width, height)
                        pixels += width.toLong() * height
                        if (pixels > MAX_PIXELS) invalid()
                    }
                } finally {
                    reader.dispose()
                }
            }
        } catch (_: ClientException) {
            invalid()
        } catch (_: Exception) {
            invalid()
        }
    }

    private fun validateWebP(bytes: ByteArray) {
        fun byte(index: Int) = bytes[index].toInt() and 255
        fun little(index: Int, length: Int): Long =
            (0 until length).fold(0L) { value, offset ->
                value or (byte(index + offset).toLong() shl (8 * offset))
            }
        if (bytes.size < 20 || little(4, 4) + 8 != bytes.size.toLong()) invalid()
        var offset = 12
        var canvas: Pair<Int, Int>? = null
        while (offset + 8 <= bytes.size) {
            val kind = String(bytes, offset, 4, Charsets.US_ASCII)
            val length = little(offset + 4, 4)
            val start = offset + 8
            if (length > bytes.size - start) invalid()
            when (kind) {
                "VP8X" -> {
                    if (length != 10L || byte(start) and 2 != 0)
                        invalid() // Animated WebP is intentionally disabled.
                    val width = (little(start + 4, 3) + 1).toInt()
                    val height = (little(start + 7, 3) + 1).toInt()
                    checkSize(width, height)
                    canvas = width to height
                }
                "VP8 " -> {
                    if (
                        length < 10 ||
                            byte(start + 3) != 157 ||
                            byte(start + 4) != 1 ||
                            byte(start + 5) != 42
                    )
                        invalid()
                    val width = (little(start + 6, 2) and 16383).toInt()
                    val height = (little(start + 8, 2) and 16383).toInt()
                    checkSize(width, height)
                    if (canvas != null && canvas != (width to height)) invalid()
                    return
                }
                "VP8L" -> {
                    if (length < 5 || byte(start) != 47) invalid()
                    val bits = little(start + 1, 4)
                    val width = ((bits and 16383) + 1).toInt()
                    val height = (((bits shr 14) and 16383) + 1).toInt()
                    checkSize(width, height)
                    if (canvas != null && canvas != (width to height)) invalid()
                    return
                }
            }
            offset = (start + length + length % 2).toInt()
        }
        invalid()
    }

    private fun checkSize(width: Int, height: Int) {
        if (
            width !in 1..MAX_DIMENSION ||
                height !in 1..MAX_DIMENSION ||
                width.toLong() * height > MAX_PIXELS
        )
            invalid()
    }

    private fun rejectAnimatedPng(bytes: ByteArray) {
        var offset = 8
        while (offset + 12 <= bytes.size) {
            val length = java.nio.ByteBuffer.wrap(bytes, offset, 4).int
            if (length < 0 || length > bytes.size - offset - 12) invalid()
            if (String(bytes, offset + 4, 4, Charsets.US_ASCII) == "acTL") invalid()
            offset += length + 12
        }
    }

    private fun invalid(): Nothing =
        throw ClientException("invalid_file", "Bild beschädigt oder zu groß (maximal 16 Megapixel)")
}
