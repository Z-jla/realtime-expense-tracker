package com.spendapp.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Matrix
import android.graphics.PointF
import android.graphics.Rect
import android.net.Uri
import androidx.core.net.toUri
import androidx.exifinterface.media.ExifInterface
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.paddle.ocr.EngineConfig
import com.paddle.ocr.PaddleOCR
import com.paddle.ocr.PaddleOCRConfig
import com.paddle.ocr.model.OCRBox
import com.paddle.ocr.model.OCRResult
import com.paddle.ocr.model.OCRRunResult
import com.paddle.ocr.util.OpenCVUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

@CapacitorPlugin(name = "PaddleOcr")
class PaddleOcrPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val initializationMutex = Mutex()
    private val recognitionMutex = Mutex()

    @Volatile
    private var ocr: PaddleOCR? = null

    @Volatile
    private var destroyed = false

    /**
     * The image handed to the engine, plus the dimensions of the pixels the engine will actually
     * see. Detection boxes are reported in that same space, so the two must never disagree.
     */
    private sealed interface AnalysisImage {
        val width: Int
        val height: Int

        class Encoded(
            val bytes: ByteArray,
            override val width: Int,
            override val height: Int,
        ) : AnalysisImage

        class Decoded(
            val bitmap: Bitmap,
            override val width: Int,
            override val height: Int,
        ) : AnalysisImage

        class Tiled(
            val bytes: ByteArray,
            val regions: List<ImageTileRegion>,
            override val width: Int,
            override val height: Int,
        ) : AnalysisImage
    }

    @PluginMethod
    fun availability(call: PluginCall) {
        scope.launch {
            try {
                getOrCreateEngine()
                call.resolve(
                    JSObject().apply {
                        put("available", true)
                        put("engine", ENGINE_NAME)
                    },
                )
            } catch (error: Throwable) {
                call.resolve(
                    JSObject().apply {
                        put("available", false)
                        put("engine", ENGINE_NAME)
                        put("reason", error.message ?: "PP-OCRv6 初始化失败")
                    },
                )
            }
        }
    }

    @PluginMethod
    fun recognize(call: PluginCall) {
        val imagePath = call.getString("imagePath")
        if (imagePath.isNullOrBlank()) {
            call.reject("缺少待识别图片")
            return
        }

        scope.launch {
            var image: AnalysisImage? = null
            try {
                val loaded = withContext(Dispatchers.IO) { loadAnalysisImage(imagePath) }
                image = loaded
                val result = recognitionMutex.withLock {
                    val engine = getOrCreateEngine()
                    when (loaded) {
                        is AnalysisImage.Encoded -> engine.recognize(loaded.bytes)
                        is AnalysisImage.Decoded -> engine.recognize(loaded.bitmap)
                        is AnalysisImage.Tiled -> recognizeTiled(engine, loaded)
                    }
                }
                val lines = JSArray()

                result.results.forEach { item ->
                    val polygon = JSArray()
                    item.box.points.forEach { point ->
                        polygon.put(
                            JSObject().apply {
                                put("x", point.x.toDouble())
                                put("y", point.y.toDouble())
                            },
                        )
                    }
                    lines.put(
                        JSObject().apply {
                            put("text", item.text)
                            put("confidence", item.confidence.toDouble())
                            put("polygon", polygon)
                        },
                    )
                }

                call.resolve(
                    JSObject().apply {
                        put("engine", ENGINE_NAME)
                        put("width", loaded.width)
                        put("height", loaded.height)
                        put("lines", lines)
                        put("totalTimeMs", result.totalTimeMs)
                        put("detectionTimeMs", result.detectionTimeMs)
                        put("recognitionTimeMs", result.recognitionTimeMs)
                        put("coldLoadTimeMs", result.coldLoadTimeMs)
                    },
                )
            } catch (error: Throwable) {
                val exception = error as? Exception ?: RuntimeException(error)
                call.reject(error.message ?: "PP-OCRv6 识别失败", exception)
            } finally {
                (image as? AnalysisImage.Decoded)?.bitmap?.recycle()
            }
        }
    }

    /**
     * Normal screenshots are passed through untouched so no re-encode softens glyph edges. Very
     * long screenshots are decoded a tile at a time; this preserves their full width without ever
     * allocating a full-height OpenCV Mat. Camera photos and EXIF-rotated images use a hard sampled
     * pixel budget.
     */
    private fun loadAnalysisImage(imagePath: String): AnalysisImage {
        val uri = imagePath.toUri()
        val declared = declaredSize(uri, imagePath)
        if (declared > MAX_IMAGE_BYTES) {
            error("图片超过 ${MAX_IMAGE_BYTES / (1024 * 1024)} MB 限制，请先裁剪或压缩后再试")
        }

        val bytes = readImageBytes(uri, imagePath, declared)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error("无法解析所选图片")

        val matrix = orientationMatrix(exifOrientation(bytes))
        if (matrix == null) {
            val encodedPixels = bounds.outWidth.toLong() * bounds.outHeight
            if (encodedPixels <= MAX_ENCODED_PIXELS) {
                return AnalysisImage.Encoded(bytes, bounds.outWidth, bounds.outHeight)
            }
            if (
                ImageSampling.shouldTile(bounds.outWidth, bounds.outHeight, MAX_ENCODED_PIXELS) &&
                supportsRegionDecoding(bytes)
            ) {
                val regions = ImageSampling.tileRegions(
                    bounds.outWidth,
                    bounds.outHeight,
                    MAX_DECODED_PIXELS,
                )
                if (regions.size > MAX_IMAGE_TILES) {
                    error("长图超过 ${MAX_IMAGE_TILES} 个识别分块，请拆成多张截图后重试")
                }
                return AnalysisImage.Tiled(
                    bytes,
                    regions,
                    bounds.outWidth,
                    bounds.outHeight,
                )
            }
        }

        val options = BitmapFactory.Options().apply {
            inSampleSize = ImageSampling.sampleSizeFor(
                bounds.outWidth,
                bounds.outHeight,
                MAX_DECODED_PIXELS,
            )
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: error("无法解码所选图片")
        if (matrix == null) return AnalysisImage.Decoded(decoded, decoded.width, decoded.height)

        val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (rotated !== decoded) decoded.recycle()
        return AnalysisImage.Decoded(rotated, rotated.width, rotated.height)
    }

    @Suppress("DEPRECATION")
    private fun supportsRegionDecoding(bytes: ByteArray): Boolean = try {
        val decoder = BitmapRegionDecoder.newInstance(bytes, 0, bytes.size, false)
        decoder.recycle()
        true
    } catch (_: Exception) {
        false
    }

    @Suppress("DEPRECATION")
    private suspend fun recognizeTiled(
        engine: PaddleOCR,
        image: AnalysisImage.Tiled,
    ): OCRRunResult {
        val decoder = BitmapRegionDecoder.newInstance(image.bytes, 0, image.bytes.size, false)
            ?: error("无法建立长图分块解码器")
        val merged = mutableListOf<OCRResult>()
        var detectionTimeMs = 0L
        var recognitionTimeMs = 0L
        var totalTimeMs = 0L
        var detPreprocessMs = 0L
        var detInferenceMs = 0L
        var detPostprocessMs = 0L
        var recPreprocessMs = 0L
        var recInferenceMs = 0L
        var recPostprocessMs = 0L
        var pipelineOverheadMs = 0L
        var coldLoadTimeMs = 0L
        var detInputShape = emptyList<Int>()
        val recInputShapes = mutableListOf<List<Int>>()
        val perLineRecMs = mutableListOf<Long>()

        try {
            for (region in image.regions) {
                val bitmap = decoder.decodeRegion(
                    Rect(region.left, region.top, region.right, region.bottom),
                    BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 },
                ) ?: error("无法解码长图分块")
                try {
                    val result = engine.recognize(bitmap)
                    result.results.forEach { mergeTileResult(merged, offsetResult(it, region)) }
                    detectionTimeMs += result.detectionTimeMs
                    recognitionTimeMs += result.recognitionTimeMs
                    totalTimeMs += result.totalTimeMs
                    detPreprocessMs += result.detPreprocessMs
                    detInferenceMs += result.detInferenceMs
                    detPostprocessMs += result.detPostprocessMs
                    recPreprocessMs += result.recPreprocessMs
                    recInferenceMs += result.recInferenceMs
                    recPostprocessMs += result.recPostprocessMs
                    pipelineOverheadMs += result.pipelineOverheadMs
                    coldLoadTimeMs = maxOf(coldLoadTimeMs, result.coldLoadTimeMs)
                    detInputShape = result.detInputShape
                    recInputShapes += result.recInputShapes
                    perLineRecMs += result.perLineRecMs
                } finally {
                    bitmap.recycle()
                }
            }
        } finally {
            decoder.recycle()
        }

        return OCRRunResult(
            results = merged,
            detectionTimeMs = detectionTimeMs,
            recognitionTimeMs = recognitionTimeMs,
            totalTimeMs = totalTimeMs,
            lineCount = merged.size,
            detPreprocessMs = detPreprocessMs,
            detInferenceMs = detInferenceMs,
            detPostprocessMs = detPostprocessMs,
            recPreprocessMs = recPreprocessMs,
            recInferenceMs = recInferenceMs,
            recPostprocessMs = recPostprocessMs,
            pipelineOverheadMs = pipelineOverheadMs,
            coldLoadTimeMs = coldLoadTimeMs,
            detInputShape = detInputShape,
            recInputShapes = recInputShapes,
            perLineRecMs = perLineRecMs,
        )
    }

    private fun offsetResult(result: OCRResult, region: ImageTileRegion): OCRResult = result.copy(
        box = offsetBox(result.box, region),
        wordBoxes = result.wordBoxes?.map { offsetBox(it, region) },
    )

    private fun offsetBox(box: OCRBox, region: ImageTileRegion): OCRBox = OCRBox(
        box.points.map { point ->
            PointF(point.x + region.left, point.y + region.top)
        },
    )

    private fun mergeTileResult(results: MutableList<OCRResult>, candidate: OCRResult) {
        val duplicateIndex = results.indexOfFirst { existing ->
            existing.text == candidate.text && boxOverlap(existing.box, candidate.box) >= 0.55f
        }
        if (duplicateIndex < 0) {
            results += candidate
        } else if (candidate.confidence > results[duplicateIndex].confidence) {
            results[duplicateIndex] = candidate
        }
    }

    private fun boxOverlap(first: OCRBox, second: OCRBox): Float {
        val firstLeft = first.points.minOf { it.x }
        val firstTop = first.points.minOf { it.y }
        val firstRight = first.points.maxOf { it.x }
        val firstBottom = first.points.maxOf { it.y }
        val secondLeft = second.points.minOf { it.x }
        val secondTop = second.points.minOf { it.y }
        val secondRight = second.points.maxOf { it.x }
        val secondBottom = second.points.maxOf { it.y }
        val intersectionWidth = (minOf(firstRight, secondRight) - maxOf(firstLeft, secondLeft))
            .coerceAtLeast(0f)
        val intersectionHeight = (minOf(firstBottom, secondBottom) - maxOf(firstTop, secondTop))
            .coerceAtLeast(0f)
        val intersection = intersectionWidth * intersectionHeight
        val firstArea = (firstRight - firstLeft).coerceAtLeast(0f) *
            (firstBottom - firstTop).coerceAtLeast(0f)
        val secondArea = (secondRight - secondLeft).coerceAtLeast(0f) *
            (secondBottom - secondTop).coerceAtLeast(0f)
        val minimumArea = minOf(firstArea, secondArea)
        return if (minimumArea <= 0f) 0f else intersection / minimumArea
    }

    /** Returns a negative value when the provider does not report a size. */
    private fun declaredSize(uri: Uri, imagePath: String): Long {
        return try {
            when (uri.scheme?.lowercase()) {
                "file" -> uri.path?.let { File(it).length() } ?: UNKNOWN_SIZE
                null, "" -> File(imagePath).length()
                else -> context.contentResolver
                    .openAssetFileDescriptor(uri, "r")
                    ?.use { it.length }
                    ?: UNKNOWN_SIZE
            }
        } catch (error: Exception) {
            UNKNOWN_SIZE
        }
    }

    private fun openStream(uri: Uri, imagePath: String): InputStream {
        val stream = when (uri.scheme?.lowercase()) {
            "content", "android.resource" -> context.contentResolver.openInputStream(uri)
            "file" -> uri.path?.let(::FileInputStream)
            null, "" -> FileInputStream(imagePath)
            else -> context.contentResolver.openInputStream(uri)
        }
        return stream ?: error("无法读取所选图片")
    }

    private fun readImageBytes(uri: Uri, imagePath: String, declared: Long): ByteArray {
        return openStream(uri, imagePath).use { stream ->
            // 尺寸已知时按精确大小一次性分配，避免 ByteArrayOutputStream 扩容带来的双倍峰值内存。
            if (declared in 1..MAX_IMAGE_BYTES) readExact(stream, declared.toInt())
            else readGrowing(stream)
        }
    }

    private fun readExact(input: InputStream, size: Int): ByteArray {
        val buffer = ByteArray(size)
        var offset = 0
        while (offset < size) {
            val count = input.read(buffer, offset, size - offset)
            if (count < 0) break
            offset += count
        }
        if (offset == 0) error("图片为空")
        if (offset == size && input.read() >= 0) error("图片大小与系统报告不一致，请重新选择")
        return if (offset == size) buffer else buffer.copyOf(offset)
    }

    private fun readGrowing(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > MAX_IMAGE_BYTES) {
                error("图片超过 ${MAX_IMAGE_BYTES / (1024 * 1024)} MB 限制，请先裁剪或压缩后再试")
            }
            output.write(buffer, 0, count)
        }
        if (total == 0L) error("图片为空")
        return output.toByteArray()
    }

    private fun exifOrientation(bytes: ByteArray): Int {
        return try {
            ByteArrayInputStream(bytes).use { stream ->
                ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL,
                )
            }
        } catch (error: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
    }

    /** Null when the image is already upright and needs no decode. */
    private fun orientationMatrix(orientation: Int): Matrix? {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
            else -> return null
        }
        return matrix
    }

    private suspend fun getOrCreateEngine(): PaddleOCR {
        check(!destroyed) { "OCR 插件已停止" }
        ocr?.let { return it }
        return initializationMutex.withLock {
            check(!destroyed) { "OCR 插件已停止" }
            ocr?.let { return@withLock it }
            val openCvReady = withContext(Dispatchers.IO) { OpenCVUtils.init(context) }
            if (!openCvReady) {
                error("OpenCV 初始化失败")
            }

            PaddleOCR.create(
                context = context,
                config = PaddleOCRConfig(
                    recScoreThresh = 0.2f,
                    recBatchSize = 4,
                ),
                engineConfig = EngineConfig(
                    numThreads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4),
                ),
            ).also { ocr = it }
        }
    }

    override fun handleOnDestroy() {
        destroyed = true
        scope.cancel()
        // The recognition coroutine resumes on Main before releasing its mutex. Waiting here with
        // runBlocking would therefore deadlock the Activity teardown while recognition is active.
        CoroutineScope(Dispatchers.IO).launch {
            recognitionMutex.withLock {
                initializationMutex.withLock {
                    val current = ocr
                    ocr = null
                    current?.release()
                }
            }
        }
        super.handleOnDestroy()
    }

    private companion object {
        const val ENGINE_NAME = "PP-OCRv6-tiny"
        const val UNKNOWN_SIZE = -1L
        const val MAX_IMAGE_BYTES = 20L * 1024 * 1024

        /** Screenshots stay untouched below this; only larger images pay for a decode. */
        const val MAX_ENCODED_PIXELS = 12_000_000L

        /** The decode path allocates two bitmaps when rotating, so it gets a tighter budget. */
        const val MAX_DECODED_PIXELS = 8_000_000L

        /** Bounds worst-case OCR time for a maliciously compressed or impractically long image. */
        const val MAX_IMAGE_TILES = 24
    }
}
