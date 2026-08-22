package com.spendapp.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.paddle.ocr.EngineConfig
import com.paddle.ocr.PaddleOCR
import com.paddle.ocr.PaddleOCRConfig
import com.paddle.ocr.util.OpenCVUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
     * Screenshots — the main use case — are passed through untouched so no re-encode softens the
     * glyph edges. Everything else (EXIF-rotated camera photos, very large images) is decoded once
     * with the correct orientation and a bounded pixel budget, which keeps the reported size in
     * step with the pixels OpenCV sees and stops a 100 MP photo from exhausting the heap.
     */
    private fun loadAnalysisImage(imagePath: String): AnalysisImage {
        val uri = Uri.parse(imagePath)
        val declared = declaredSize(uri, imagePath)
        if (declared > MAX_IMAGE_BYTES) {
            error("图片超过 ${MAX_IMAGE_BYTES / (1024 * 1024)} MB 限制，请先裁剪或压缩后再试")
        }

        val bytes = readImageBytes(uri, imagePath, declared)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error("无法解析所选图片")

        val matrix = orientationMatrix(exifOrientation(bytes))
        if (matrix == null && sampleSizeFor(bounds, MAX_ENCODED_PIXELS) == 1) {
            return AnalysisImage.Encoded(bytes, bounds.outWidth, bounds.outHeight)
        }

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(bounds, MAX_DECODED_PIXELS)
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: error("无法解码所选图片")
        if (matrix == null) return AnalysisImage.Decoded(decoded, decoded.width, decoded.height)

        val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (rotated !== decoded) decoded.recycle()
        return AnalysisImage.Decoded(rotated, rotated.width, rotated.height)
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

    private fun sampleSizeFor(bounds: BitmapFactory.Options, maxPixels: Long): Int {
        var sample = 1
        while (
            (bounds.outWidth.toLong() / sample) * (bounds.outHeight.toLong() / sample) > maxPixels
        ) {
            sample *= 2
        }
        return sample
    }

    private suspend fun getOrCreateEngine(): PaddleOCR {
        ocr?.let { return it }
        return initializationMutex.withLock {
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
        val current = ocr
        ocr = null
        if (current != null) {
            runBlocking(Dispatchers.IO) { current.release() }
        }
        scope.cancel()
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
    }
}
