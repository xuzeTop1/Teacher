package com.hxz.alerttime.app.ui.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 扫码结果处理边界：取消扫码静默处理；成功扫码只进入配对流程。
 */
class ScanResultBoundaryTest {

    @Test
    fun `cancelled scan produces Cancelled outcome`() {
        assertEquals(ScanOutcome.Cancelled, ScanResultBoundary.classify(null))
        assertEquals(ScanOutcome.Cancelled, ScanResultBoundary.classify(""))
        assertEquals(ScanOutcome.Cancelled, ScanResultBoundary.classify("   "))
    }

    @Test
    fun `successful scan produces ReadyToPair with the raw qr text`() {
        val qrText = "ta-sync://v1?host=192.168.1.50&port=8787&pin=abc&token=xyz&expiresAt=100&deviceId=12345678"
        val outcome = ScanResultBoundary.classify(qrText)
        assertTrue(outcome is ScanOutcome.ReadyToPair)
        assertEquals(qrText, (outcome as ScanOutcome.ReadyToPair).qrText)
    }

    @Test
    fun `qr text is not blanked or transformed`() {
        val qrText = "  ta-sync://v1?host=192.168.1.50&port=8787&pin=abc&token=xyz&expiresAt=100&deviceId=12345678  "
        val outcome = ScanResultBoundary.classify(qrText)
        // 原样透传；配对解析阶段负责 trim 与结构校验。
        assertEquals(qrText, (outcome as ScanOutcome.ReadyToPair).qrText)
    }
}
