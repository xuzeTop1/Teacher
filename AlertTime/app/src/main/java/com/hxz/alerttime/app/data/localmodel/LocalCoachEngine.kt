package com.hxz.alerttime.app.data.localmodel

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong

internal object QwenNative {
    init { System.loadLibrary("alerttime_qwen") }
    external fun generate(modelPath: String, prompt: ByteArray, grammar: ByteArray, requestId: Long): ByteArray
    external fun cancel(requestId: Long)
}

/** Process-wide serialization; no network client, Room writes, logging or cloud fallback. */
class LocalCoachEngine(context: Context) {
    private val context = context.applicationContext

    suspend fun analyze(task: CoachTask, text: String, requestId: Long): CoachResult = withContext(Dispatchers.IO) {
        check(Build.SUPPORTED_ABIS.contains("arm64-v8a"))
        val prompt = LocalCoachContract.prompt(task, text)
        mutex.withLock {
            currentCoroutineContext().ensureActive()
            val model = prepareModel()
            currentCoroutineContext().ensureActive()
            val grammar = context.assets.open("local-coach/${task.grammar}").use { it.readBytes() }
            val output = QwenNative.generate(model.absolutePath, prompt.toByteArray(Charsets.UTF_8), grammar, requestId)
            currentCoroutineContext().ensureActive()
            LocalCoachContract.parse(task, output.toString(Charsets.UTF_8))
        }
    }

    fun cancel(requestId: Long) {
        if (requestId == 0L) return
        try { QwenNative.cancel(requestId) } catch (_: LinkageError) { /* Build/ABI error is reported by analyze. */ }
    }

    private suspend fun prepareModel(): File {
        val directory = File(context.noBackupFilesDir, "local-coach").apply { mkdirs() }
        val destination = File(directory, MODEL_FILE)
        // Cache lives outside backup. Verify on every request, not just on first extraction.
        if (destination.isFile && destination.length() == MODEL_SIZE && digest(destination) == MODEL_SHA256) return destination
        val temporary = File(directory, "$MODEL_FILE.partial")
        try {
            context.assets.open("local-coach/$MODEL_FILE").use { source ->
                temporary.outputStream().use { output ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = source.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            check(temporary.length() == MODEL_SIZE && digest(temporary) == MODEL_SHA256)
            check(temporary.renameTo(destination))
            return destination
        } finally {
            temporary.delete()
        }
    }

    private suspend fun digest(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val MODEL_FILE = "qwen2.5-0.5b-bkt-v2-q4_k_m.gguf"
        const val MODEL_SIZE = 397807424L
        const val MODEL_SHA256 = "daed6c55a53da9196c8ce1f6ce5b645d731ad628d3b78946b0f564dd56e83cf8"
        private val mutex = Mutex()
        private val ids = AtomicLong()
        fun nextRequestId(): Long = ids.incrementAndGet()
    }
}
