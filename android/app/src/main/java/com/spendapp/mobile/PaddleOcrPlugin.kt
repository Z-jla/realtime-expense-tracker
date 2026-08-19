package com.spendapp.mobile

import android.util.Base64
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

@CapacitorPlugin(name = "PaddleOcr")
class PaddleOcrPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val initializationMutex = Mutex()
    private val recognitionMutex = Mutex()

    @Volatile
    private var ocr: PaddleOCR? = null

    @PluginMethod
    fun availability(call: PluginCall) {
        call.resolve(
            JSObject().apply {
                put("available", true)
                put("engine", ENGINE_NAME)
            },
        )
    }

    @PluginMethod
    fun recognize(call: PluginCall) {
        val encodedImage = call.getString("imageBase64")
        if (encodedImage.isNullOrBlank()) {
            call.reject("缺少待识别图片")
            return
        }

        val imageBytes = try {
            val payload = encodedImage.substringAfter(',', encodedImage)
            Base64.decode(payload, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            call.reject("图片编码无效", error)
            return
        }

        if (imageBytes.isEmpty() || imageBytes.size > MAX_IMAGE_BYTES) {
            call.reject("图片为空或超过 12 MB 限制")
            return
        }

        scope.launch {
            try {
                val result = recognitionMutex.withLock {
                    getOrCreateEngine().recognize(imageBytes)
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
            }
        }
    }

    private suspend fun getOrCreateEngine(): PaddleOCR {
        ocr?.let { return it }
        return initializationMutex.withLock {
            ocr?.let { return@withLock it }
            if (!OpenCVUtils.init(context)) {
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
        const val MAX_IMAGE_BYTES = 12 * 1024 * 1024
    }
}
