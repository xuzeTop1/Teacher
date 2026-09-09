package com.hxz.alerttime.app.core.window

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.PowerManager

/**
 * 窗口状态检测与分类（小窗 / 画中画 / 分屏 / 后台 / 锁屏）。
 *
 * 能力边界（诚实声明）：
 * - 能检测：本应用自身的窗口模式（普通全屏 / 分屏多窗口 / 画中画）、屏幕锁定或熄屏、
 *   应用真正进入后台（ON_STOP 且不是上述情形）。
 * - 不能检测：其他 App 以悬浮窗覆盖本应用的窗口层级。SYSTEM_ALERT_WINDOW 权限只能让
 *   本应用绘制悬浮窗，不能观察别人的悬浮窗；观察其他应用窗口只能通过用户主动开启的
 *   AccessibilityService（本项目未实现，未开启时 UI 必须显示「无法判断其他应用是否处于
 *   悬浮窗」，不得伪造检测结果）。
 *
 * [WindowStateHolder] 是进程级单例：由 [WindowStateReporter]（MainActivity）持续更新，
 * 生命周期观察者（AlertTimeApp）与计时器只读使用，避免 Activity 重建后状态丢失。
 */

/** 窗口模式分类。 */
enum class WindowMode {
    /** 普通全屏前台 */
    NORMAL,

    /** 系统分屏 / 多窗口（本应用窗口可见但非全屏） */
    MULTI_WINDOW,

    /** 画中画（本应用窗口以小窗形式浮在其他界面之上） */
    PICTURE_IN_PICTURE,

    /** 应用真正进入后台（ON_STOP 且不是小窗/分屏/画中画/锁屏） */
    BACKGROUND,

    /** 锁屏或熄屏 */
    SCREEN_LOCKED,

    /**
     * 其他应用悬浮在本应用上方，但系统无法可靠提供窗口信息。
     * 当前无 AccessibilityService 实现，任何 ON_STOP 都无法可靠区分
     * 「被悬浮窗覆盖」与「真正后台」——按 [BACKGROUND] 保守处理，
     * 并在 UI 中如实说明。
     */
    EXTERNAL_OVERLAY_UNKNOWN
}

/**
 * 进程级窗口状态持有者。
 *
 * [currentMode] 由 MainActivity 的 onPictureInPictureModeChanged /
 * onMultiWindowModeChanged / onConfigurationChanged 持续更新；
 * 锁屏/熄屏状态在每次读取时实时检查（避免依赖回调时序）。
 */
object WindowStateHolder {
    @Volatile
    var currentMode: WindowMode = WindowMode.NORMAL
        private set

    @Volatile
    var inPictureInPicture: Boolean = false
        private set

    @Volatile
    var inMultiWindow: Boolean = false
        private set

    /**
     * 最近一次检测到「非本应用悬浮窗覆盖」的时刻（epoch 毫秒）。
     * 由 [OverlayDetectionService]（可选，用户主动开启）写入；0 = 未检测到。
     * 未开启无障碍服务时恒为 0，功能完全降级。
     */
    @Volatile
    var overlayDetectedAt: Long = 0
        internal set

    /** 无障碍服务已开启且最近 [withinMs] 内检测到悬浮窗覆盖。 */
    fun overlayDetectedRecently(withinMs: Long = OVERLAY_RECENT_WINDOW_MS): Boolean {
        val detectedAt = overlayDetectedAt
        return detectedAt > 0 && System.currentTimeMillis() - detectedAt <= withinMs
    }

    /** 由 MainActivity 窗口回调更新；锁屏状态实时检查，不在此持久化。 */
    fun update(activity: Activity?) {
        val pip = activity?.isInPictureInPictureMode == true
        val multi = activity?.isInMultiWindowMode == true
        inPictureInPicture = pip
        inMultiWindow = multi
        currentMode = when {
            pip -> WindowMode.PICTURE_IN_PICTURE
            multi -> WindowMode.MULTI_WINDOW
            else -> WindowMode.NORMAL
        }
    }

    /** 实时锁屏/熄屏检查（不依赖回调时序，ON_STOP 前调用）。 */
    fun isScreenLocked(context: Context): Boolean {
        val powerManager = context.getSystemService(PowerManager::class.java)
        val keyguardManager = context.getSystemService(KeyguardManager::class.java)
        return powerManager?.isInteractive == false || keyguardManager?.isKeyguardLocked == true
    }

    /**
     * 计算 ON_STOP 时刻的真实窗口状态（供生命周期观察者使用）。
     *
     * @param overlayDetected 无障碍服务（用户主动开启）最近检测到非本应用悬浮窗覆盖。
     *   开启且检测到时返回 EXTERNAL_OVERLAY_UNKNOWN（暂停但不记分心——可能是 AI 悬浮窗学习）；
     *   未开启 / 未检测到时按真正后台处理。
     */
    fun resolveOnStopMode(
        context: Context,
        activity: Activity?,
        overlayDetected: Boolean = false
    ): WindowMode {
        if (isScreenLocked(context)) return WindowMode.SCREEN_LOCKED
        if (activity?.isInPictureInPictureMode == true) return WindowMode.PICTURE_IN_PICTURE
        if (activity?.isInMultiWindowMode == true) return WindowMode.MULTI_WINDOW
        if (overlayDetected) return WindowMode.EXTERNAL_OVERLAY_UNKNOWN
        // 其他 App 悬浮窗无法可靠检测（未开启无障碍服务）：未知即按后台保守处理。
        return WindowMode.BACKGROUND
    }

    /** 悬浮窗覆盖「最近」的判定窗口（毫秒）。 */
    private const val OVERLAY_RECENT_WINDOW_MS: Long = 5_000L
}

/**
 * 窗口状态上报接口：由 MainActivity 实现并在生命周期回调中调用。
 * 与生命周期解耦：Compose 层通过 [WindowStateHolder] 读取。
 */
interface WindowStateReporter {
    fun reportWindowStateChanged(activity: Activity)
}

/** 窗口模式的中文展示标签（UI 用）。 */
fun WindowMode.displayLabel(): String = when (this) {
    WindowMode.NORMAL -> "普通全屏"
    WindowMode.MULTI_WINDOW -> "分屏"
    WindowMode.PICTURE_IN_PICTURE -> "画中画"
    WindowMode.BACKGROUND -> "后台"
    WindowMode.SCREEN_LOCKED -> "锁屏"
    WindowMode.EXTERNAL_OVERLAY_UNKNOWN -> "无法判断（可能被悬浮窗覆盖）"
}

/** 是否属于「学习可视」状态：小窗/分屏/画中画中学习继续进行。 */
fun WindowMode.isLearningVisible(): Boolean = when (this) {
    WindowMode.NORMAL,
    WindowMode.MULTI_WINDOW,
    WindowMode.PICTURE_IN_PICTURE -> true
    WindowMode.BACKGROUND,
    WindowMode.SCREEN_LOCKED,
    WindowMode.EXTERNAL_OVERLAY_UNKNOWN -> false
}

/**
 * 是否需要在 ON_STOP 时暂停计时。
 *
 * 专注进行中锁屏 / 熄屏不应中断计时：用户重新解锁后，应得到完整的连续专注时长。
 * 这与“窗口是否仍可见”是两件事，因此不能简单复用 [isLearningVisible]。
 */
fun WindowMode.pausesTimerOnStop(): Boolean = when (this) {
    WindowMode.NORMAL,
    WindowMode.MULTI_WINDOW,
    WindowMode.PICTURE_IN_PICTURE,
    WindowMode.SCREEN_LOCKED -> false
    WindowMode.BACKGROUND,
    WindowMode.EXTERNAL_OVERLAY_UNKNOWN -> true
}

/**
 * 是否在 ON_STOP 时记录一次分心。
 * 只有真正后台记录；「检测到外部悬浮窗覆盖」（EXTERNAL_OVERLAY_UNKNOWN，无障碍服务
 * 用户主动开启后才有该信号）不记分心——用户可能正在 AI 悬浮窗中学习；
 * 无障碍服务未开启时无法检测，按真正后台处理（记分心，保守）。
 * 锁屏 / 分屏 / 画中画 / 普通全屏不记录。
 */
fun WindowMode.recordsDistractionOnStop(): Boolean = this == WindowMode.BACKGROUND

/** Manifest 需要的 configChanges（避免旋转/尺寸/字体缩放等变化导致 Activity 重建产生假 ON_STOP）。 */
val ACTIVITY_CONFIG_CHANGES: Int = ActivityInfo.CONFIG_ORIENTATION or
    ActivityInfo.CONFIG_SCREEN_SIZE or
    ActivityInfo.CONFIG_SCREEN_LAYOUT or
    ActivityInfo.CONFIG_SMALLEST_SCREEN_SIZE or
    ActivityInfo.CONFIG_KEYBOARD_HIDDEN or
    ActivityInfo.CONFIG_UI_MODE or
    ActivityInfo.CONFIG_FONT_SCALE or
    ActivityInfo.CONFIG_DENSITY or
    ActivityInfo.CONFIG_LAYOUT_DIRECTION

/** 是否支持画中画（API 26+）。 */
val supportsPictureInPicture: Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
