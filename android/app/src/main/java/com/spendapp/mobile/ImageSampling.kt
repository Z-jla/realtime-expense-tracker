package com.spendapp.mobile

internal data class ImageTileRegion(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
)

/** Decode and tiling decisions kept free of Android types so they can run in JVM tests. */
internal object ImageSampling {
    private const val MAX_TILE_SHORT_EDGE = 2160
    private const val MAX_TILE_LONG_EDGE = 4000
    private const val TILE_OVERLAP = 192

    /** Power-of-two sampling with a hard pixel ceiling. It never trades heap safety for clarity. */
    fun sampleSizeFor(width: Int, height: Int, maxPixels: Long): Int {
        if (width <= 0 || height <= 0 || maxPixels <= 0) return 1
        var sample = 1
        while (pixelsAt(width, height, sample) > maxPixels) sample *= 2
        return sample
    }

    /**
     * Long screenshots are tiled instead of globally downsampled. Ordinary high-resolution camera
     * photos still use sampling: dividing those into a grid would multiply OCR time without helping
     * the bill-list use case.
     */
    fun shouldTile(width: Int, height: Int, encodedPixelLimit: Long): Boolean {
        if (width <= 0 || height <= 0) return false
        val shortEdge = minOf(width, height)
        val longEdge = maxOf(width, height)
        return width.toLong() * height > encodedPixelLimit &&
            shortEdge <= MAX_TILE_SHORT_EDGE &&
            longEdge >= shortEdge * 2L
    }

    /** Full-width or full-height overlapping regions, each bounded by [maxTilePixels]. */
    fun tileRegions(width: Int, height: Int, maxTilePixels: Long): List<ImageTileRegion> {
        require(width > 0 && height > 0) { "Image dimensions must be positive" }
        require(maxTilePixels > 0) { "Tile pixel limit must be positive" }

        val vertical = height >= width
        val shortEdge = if (vertical) width else height
        val longEdge = if (vertical) height else width
        val pixelLimitedSpan = (maxTilePixels / shortEdge)
            .coerceAtLeast(1)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        val span = minOf(longEdge, MAX_TILE_LONG_EDGE, pixelLimitedSpan)
        val overlap = minOf(TILE_OVERLAP, span / 3)
        val step = (span - overlap).coerceAtLeast(1)
        val regions = mutableListOf<ImageTileRegion>()
        var start = 0

        while (start < longEdge) {
            val end = minOf(start + span, longEdge)
            regions += if (vertical) {
                ImageTileRegion(0, start, width, end)
            } else {
                ImageTileRegion(start, 0, end, height)
            }
            if (end == longEdge) break
            start += step
        }
        return regions
    }

    fun pixelsAt(width: Int, height: Int, sample: Int): Long =
        (width.toLong() / sample) * (height.toLong() / sample)
}
