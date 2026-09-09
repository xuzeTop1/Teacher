package com.hxz.alerttime.app.ui.sync

/**
 * 扫码结果处理边界（纯函数，可单元测试）。
 *
 * - 用户取消扫码（contents 为空）→ Cancelled：静默处理，不报错。
 * - 扫码成功 → ReadyToPair(qrText)：qrText 只进入配对流程的内存路径，不落盘、不写日志。
 */
sealed interface ScanOutcome {
    data object Cancelled : ScanOutcome
    data class ReadyToPair(val qrText: String) : ScanOutcome
}

object ScanResultBoundary {
    fun classify(contents: String?): ScanOutcome {
        return when {
            contents.isNullOrBlank() -> ScanOutcome.Cancelled
            else -> ScanOutcome.ReadyToPair(contents)
        }
    }
}
