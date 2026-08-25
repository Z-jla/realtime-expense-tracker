package com.spendapp.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageSamplingTest {
    @Test
    fun `tall bill screenshot is tiled without shrinking its width`() {
        assertTrue(ImageSampling.shouldTile(1080, 30000, 12_000_000L))
        val regions = ImageSampling.tileRegions(1080, 30000, 8_000_000L)

        assertEquals(0, regions.first().top)
        assertEquals(30000, regions.last().bottom)
        assertTrue(regions.size > 1)
        assertTrue(regions.all { it.left == 0 && it.right == 1080 })
        assertTrue(
            regions.all {
                (it.right - it.left).toLong() * (it.bottom - it.top) <= 8_000_000L
            },
        )
        assertTrue(regions.zipWithNext().all { (first, second) -> second.top < first.bottom })
    }

    @Test
    fun `wide long screenshot uses horizontal tiles`() {
        assertTrue(ImageSampling.shouldTile(12000, 1080, 12_000_000L))
        val regions = ImageSampling.tileRegions(12000, 1080, 8_000_000L)
        assertEquals(0, regions.first().left)
        assertEquals(12000, regions.last().right)
        assertTrue(regions.all { it.top == 0 && it.bottom == 1080 })
    }

    @Test
    fun `ordinary camera photo downsamples under the hard pixel budget`() {
        assertFalse(ImageSampling.shouldTile(12000, 9000, 12_000_000L))
        val sample = ImageSampling.sampleSizeFor(12000, 9000, 8_000_000L)
        assertEquals(4, sample)
        assertTrue(ImageSampling.pixelsAt(12000, 9000, sample) <= 8_000_000L)
    }

    @Test
    fun `sampling never exceeds the requested budget even on a narrow giant`() {
        val sample = ImageSampling.sampleSizeFor(1080, 60000, 8_000_000L)
        assertEquals(4, sample)
        assertTrue(ImageSampling.pixelsAt(1080, 60000, sample) <= 8_000_000L)
    }

    @Test
    fun `images already inside the budget are never sampled`() {
        assertEquals(1, ImageSampling.sampleSizeFor(1080, 1920, 8_000_000L))
        assertEquals(1, ImageSampling.sampleSizeFor(300, 300, 8_000_000L))
    }

    @Test
    fun `degenerate bounds fall back to no sampling and are not tiled`() {
        assertEquals(1, ImageSampling.sampleSizeFor(0, 0, 8_000_000L))
        assertEquals(1, ImageSampling.sampleSizeFor(-1, 500, 8_000_000L))
        assertFalse(ImageSampling.shouldTile(0, 0, 8_000_000L))
    }
}
