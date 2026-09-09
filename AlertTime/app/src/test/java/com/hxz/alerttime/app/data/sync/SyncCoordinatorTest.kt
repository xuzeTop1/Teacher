package com.hxz.alerttime.app.data.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 配对二维码解析（纯函数）与协议 id 校验测试。
 */
class SyncCoordinatorTest {

    private fun validQr(expiresAtMs: Long = 1785600000000L): String {
        return "ta-sync://v1?host=192.168.1.50&port=8787&pin=abc123def456&token=xyz-token-123&expiresAt=$expiresAtMs&deviceId=f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
    }

    @Test
    fun `parses valid pairing qr`() {
        val info = SyncCoordinator.parsePairingQr(validQr(), nowMs = 1785590000000L)
        assertEquals("192.168.1.50", info.host)
        assertEquals(8787, info.port)
        assertEquals("abc123def456", info.pin)
        assertEquals("xyz-token-123", info.token)
        assertEquals("f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6", info.deviceId)
    }

    @Test
    fun `rejects wrong scheme and missing fields`() {
        assertThrows(SyncValidationException::class.java) {
            SyncCoordinator.parsePairingQr("http://192.168.1.50:8787", nowMs = 1)
        }
        assertThrows(SyncValidationException::class.java) {
            SyncCoordinator.parsePairingQr(
                "ta-sync://v1?host=192.168.1.50&port=8787&pin=abc&token=xyz&expiresAt=100",
                nowMs = 1
            )
        }
    }

    @Test
    fun `rejects expired qr`() {
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCoordinator.parsePairingQr(validQr(expiresAtMs = 100), nowMs = 200)
        }
        assertTrue(error.message!!.contains("过期"))
    }

    @Test
    fun `rejects host with url metacharacters and accepts hostname`() {
        // host 直接进入 https URL：路径、userinfo、查询与空白成分必须被拒。
        listOf(
            "evil.com/path",
            "evil.com@10.0.0.9",
            "10.0.0.9?x=1",
            "10.0.0.9:8787",
            "10.0.0.9 evil",
            "[::1]"
        ).forEach { badHost ->
            val qr = validQr().replace("host=192.168.1.50", "host=${java.net.URLEncoder.encode(badHost, "UTF-8")}")
            val error = assertThrows(SyncValidationException::class.java) {
                SyncCoordinator.parsePairingQr(qr, nowMs = 1785590000000L)
            }
            assertTrue(error.message!!.contains("主机地址非法"))
        }
        val hostnameQr = validQr().replace("host=192.168.1.50", "host=desktop-lan.local")
        assertEquals("desktop-lan.local", SyncCoordinator.parsePairingQr(hostnameQr, nowMs = 1785590000000L).host)
    }

    @Test
    fun `token never appears in error messages`() {
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCoordinator.parsePairingQr("ta-sync://v1?host=192.168.1.50&port=8787&pin=abc&token=s3cr3t-token&expiresAt=100", nowMs = 200)
        }
        assertTrue(!error.message!!.contains("s3cr3t"))
    }

    @Test
    fun `id plausibility guard`() {
        assertTrue(SyncCodec.isPlausibleId("f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"))
        assertTrue(!SyncCodec.isPlausibleId("short"))
        assertTrue(!SyncCodec.isPlausibleId(""))
        assertTrue(!SyncCodec.isPlausibleId("id with spaces"))
    }
}
