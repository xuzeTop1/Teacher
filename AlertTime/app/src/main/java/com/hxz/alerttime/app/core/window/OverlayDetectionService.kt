package com.hxz.alerttime.app.core.window

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import android.view.accessibility.AccessibilityNodeInfo

/**
 * 可选的外部悬浮窗检测（AccessibilityService）。
 *
 * 能力边界（诚实声明）：
 * - 只能检测「非本应用的悬浮窗/系统窗口出现在本应用之上」这一事件（WINDOW_STATE_CHANGED /
 *   WINDOWS_CHANGED + 窗口类型判断），并把最近检测结果写入 [WindowStateHolder.overlayDetectedAt]；
 * - 不能 100% 区分悬浮窗类型（TYPE_APPLICATION_OVERLAY / bubble / 无障碍悬浮），
 *   判定为「可能被悬浮窗覆盖」（EXTERNAL_OVERLAY_UNKNOWN）；
 * - 必须由用户主动开启（系统无障碍设置），未开启时功能完全降级（不检测、不影响任何功能）；
 * - 隐私风险说明（android:description 与 UI 均展示）：本服务只读取窗口存在性/包名，
 *   不读取、不上传任何窗口内容或输入。
 */
class OverlayDetectionService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOWS_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 200
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        updateOverlayState()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        when (event?.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED -> updateOverlayState()
        }
    }

    override fun onInterrupt() = Unit

    private fun updateOverlayState() {
        val windows = windows ?: return
        val selfPackage = packageName
        // 检测非本应用的悬浮窗/系统窗口（overlay 类型或与全屏应用窗口不同的系统窗口）。
        val overlaySeen = windows.any { window ->
            if (window.type == AccessibilityWindowInfo.TYPE_APPLICATION) {
                // 普通应用窗口（含全屏的 Gemini/ChatGPT）：不是悬浮窗。
                return@any false
            }
            if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD ||
                window.type == AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER ||
                window.type == AccessibilityWindowInfo.TYPE_MAGNIFICATION_OVERLAY
            ) {
                return@any false
            }
            val rootPackage = window.root?.packageName?.toString()
            rootPackage != null && rootPackage != selfPackage
        }
        // 本应用重新成为顶层窗口时清除覆盖标记。
        val selfTop = rootInActiveWindow?.packageName?.toString() == selfPackage
        if (overlaySeen) {
            WindowStateHolder.overlayDetectedAt = System.currentTimeMillis()
        } else if (selfTop) {
            WindowStateHolder.overlayDetectedAt = 0
        }
    }

    companion object {
        /** 无障碍服务是否已由用户在系统设置中开启。 */
        fun isEnabled(context: Context): Boolean {
            val expected = ComponentName(context, OverlayDetectionService::class.java)
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            return enabledServices.split(':').any { flat ->
                ComponentName.unflattenFromString(flat) == expected
            }
        }

        /** 打开系统无障碍设置入口。 */
        fun accessibilitySettingsIntent(): android.content.Intent {
            return android.content.Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
