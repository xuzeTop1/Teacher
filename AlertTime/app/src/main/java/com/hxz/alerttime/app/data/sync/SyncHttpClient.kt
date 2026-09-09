package com.hxz.alerttime.app.data.sync

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 局域网 HTTPS 客户端：只信任配对二维码中的证书 pin（SPKI SHA-256）。
 *
 * - 服务端证书 SPKI 的 SHA-256 必须与 pin 一致，否则拒绝连接。
 * - 主机名校验被 pin 取代（自签证书的 SAN 只是信息性的）。
 * - 请求超时、读取超时、请求体/响应体 8 MiB 上限。
 * - 日志脱敏：本客户端不打印 token / credential / 请求体。
 */
class SyncHttpClient(private val host: String, private val port: Int, private val pinHex: String) {

    @Serializable
    private data class ErrorEnvelope(
        val code: String? = null,
        val message: String? = null,
        val error: SyncErrorBody? = null
    )

    @Serializable
    private data class SyncErrorBody(val code: String? = null, val message: String? = null)

    private val json = Json { ignoreUnknownKeys = true }

    private val trustManager = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
            // 服务端模式不使用客户端证书。
        }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            val presented = chain.firstOrNull()
                ?: throw SecurityException("服务端未提供证书")
            val spki = presented.publicKey.encoded
            val digest = MessageDigest.getInstance("SHA-256").digest(spki)
            val actual = digest.joinToString("") { "%02x".format(it) }
            if (!actual.equals(pinHex.lowercase(), ignoreCase = true)) {
                throw SecurityException("证书 pin 不匹配，已拒绝连接")
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private val sslContext: SSLContext = SSLContext.getInstance("TLS").apply {
        init(null, arrayOf<TrustManager>(trustManager), null)
    }

    /** 默认主机名校验被 pin 取代。 */
    private val hostnameVerifier = HostnameVerifier { _: String?, _: SSLSession? -> true }

    private fun baseUrl(): String {
        if (host.isBlank() || port !in 1..65535) {
            throw SyncValidationException("配对信息无效（地址或端口缺失）")
        }
        return "$host:$port"
    }

    /**
     * POST JSON 并返回响应体文本。
     * @param bearerToken 设备凭据（配对成功后使用）；配对请求不传。
     * @throws SyncApiError 服务端结构化错误
     * @throws IOException 网络/超时错误
     * @throws SecurityException pin 校验失败
     */
    fun postJson(path: String, body: String, bearerToken: String? = null): String {
        return request(path, body, bearerToken)
    }

    fun getJson(path: String, bearerToken: String? = null): String {
        return request(path, null, bearerToken)
    }

    private fun request(path: String, body: String?, bearerToken: String?): String {
        val connection = openConnection(path)
        try {
            connection.requestMethod = if (body != null) "POST" else "GET"
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            if (bearerToken != null) {
                connection.setRequestProperty("Authorization", "Bearer $bearerToken")
            }
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                if (bytes.size > SyncProtocol.MAX_SYNC_BYTES) {
                    throw SyncValidationException("请求体超过 8 MiB 上限")
                }
                connection.doOutput = true
                connection.outputStream.use { it.write(bytes) }
            }

            val status = connection.responseCode
            val responseText = if (status in 200..299) {
                connection.inputStream.use { readAllBounded(it) }
            } else {
                connection.errorStream?.use { readAllBounded(it) } ?: ""
            }

            if (status !in 200..299) {
                // Rust 服务端使用顶层 {code,message}；兼容旧版嵌套 error 结构。
                val parsed = runCatching { json.decodeFromString(ErrorEnvelope.serializer(), responseText) }
                    .getOrNull()
                val errorBody = parsed?.error
                throw SyncApiError(
                    code = parsed?.code ?: errorBody?.code ?: "http_$status",
                    message = parsed?.message ?: errorBody?.message ?: "请求失败（HTTP $status）"
                )
            }
            return responseText
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(path: String): HttpsURLConnection {
        val connection = URL("https://${baseUrl()}$path").openConnection() as HttpsURLConnection
        connection.sslSocketFactory = sslContext.socketFactory
        connection.hostnameVerifier = hostnameVerifier
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        return connection
    }

    private fun readAllBounded(input: InputStream): String {
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        val out = ByteArrayOutputStream()
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            total += read
            if (total > SyncProtocol.MAX_SYNC_BYTES) {
                throw SyncValidationException("响应超过 8 MiB 上限")
            }
            out.write(buffer, 0, read)
        }
        return out.toString(Charsets.UTF_8.name())
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 5_000
        private const val READ_TIMEOUT_MS = 20_000
    }
}
