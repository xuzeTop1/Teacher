package com.hxz.alerttime.app.core.window

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 窗口状态分类测试（验收组 1：WindowState）。
 *
 * 转换矩阵（每种转换最多记录一次事件的语义由 [recordsDistractionOnStop] /
 * [pausesTimerOnStop] 谓词 + HomeViewModel 的幂等暂停保证）：
 * - 普通全屏 → 分屏：不暂停、不记分心；
 * - 分屏 → 全屏：恢复可见（不触发暂停逻辑）；
 * - 普通全屏 → 画中画：不暂停、不记分心；
 * - 画中画 → 全屏：恢复可见；
 * - 屏幕锁定：继续计时且不记分心；
 * - 真正后台：暂停且记一次分心。
 */
class WindowStateTest {

    @Test
    fun `normal fullscreen is learning visible and does not pause`() {
        val mode = WindowMode.NORMAL
        assertTrue(mode.isLearningVisible())
        assertFalse(mode.pausesTimerOnStop())
        assertFalse(mode.recordsDistractionOnStop())
    }

    @Test
    fun `multi window keeps learning and records no distraction`() {
        val mode = WindowMode.MULTI_WINDOW
        assertTrue(mode.isLearningVisible())
        assertFalse(mode.pausesTimerOnStop())
        assertFalse(mode.recordsDistractionOnStop())
    }

    @Test
    fun `picture in picture keeps learning and records no distraction`() {
        val mode = WindowMode.PICTURE_IN_PICTURE
        assertTrue(mode.isLearningVisible())
        assertFalse(mode.pausesTimerOnStop())
        assertFalse(mode.recordsDistractionOnStop())
    }

    @Test
    fun `screen locked keeps timing and records no distraction`() {
        val mode = WindowMode.SCREEN_LOCKED
        assertFalse(mode.isLearningVisible())
        assertFalse(mode.pausesTimerOnStop())
        assertFalse(mode.recordsDistractionOnStop())
    }

    @Test
    fun `true background pauses and records exactly one distraction`() {
        val mode = WindowMode.BACKGROUND
        assertFalse(mode.isLearningVisible())
        assertTrue(mode.pausesTimerOnStop())
        assertTrue(mode.recordsDistractionOnStop())
    }

    @Test
    fun `detected external overlay pauses but records no distraction`() {
        // 无障碍服务检测到覆盖（EXTERNAL_OVERLAY_UNKNOWN）：暂停计时，但不记分心
        // （用户可能正在 AI 悬浮窗中学习）。
        val mode = WindowMode.EXTERNAL_OVERLAY_UNKNOWN
        assertFalse(mode.isLearningVisible())
        assertTrue(mode.pausesTimerOnStop())
        assertFalse(mode.recordsDistractionOnStop())
    }

    @Test
    fun `fullscreen to multi window transition never records distraction`() {
        val before = WindowMode.NORMAL
        val after = WindowMode.MULTI_WINDOW
        assertFalse(before.recordsDistractionOnStop())
        assertFalse(after.recordsDistractionOnStop())
    }

    @Test
    fun `fullscreen to pip transition never records distraction`() {
        val before = WindowMode.NORMAL
        val after = WindowMode.PICTURE_IN_PICTURE
        assertFalse(before.recordsDistractionOnStop())
        assertFalse(after.recordsDistractionOnStop())
    }

    @Test
    fun `only true background records distraction`() {
        WindowMode.entries.forEach { mode ->
            assertEquals(
                "mode=$mode 的分心记录语义错误",
                mode == WindowMode.BACKGROUND,
                mode.recordsDistractionOnStop()
            )
        }
    }

    @Test
    fun `display labels are stable and human readable`() {
        assertEquals("普通全屏", WindowMode.NORMAL.displayLabel())
        assertEquals("分屏", WindowMode.MULTI_WINDOW.displayLabel())
        assertEquals("画中画", WindowMode.PICTURE_IN_PICTURE.displayLabel())
        assertEquals("后台", WindowMode.BACKGROUND.displayLabel())
        assertEquals("锁屏", WindowMode.SCREEN_LOCKED.displayLabel())
        assertTrue(WindowMode.EXTERNAL_OVERLAY_UNKNOWN.displayLabel().contains("无法判断"))
    }

    @Test
    fun `window state holder update maps activity flags to modes`() {
        // 无 Activity：普通状态。
        WindowStateHolder.update(activity = null)
        assertEquals(WindowMode.NORMAL, WindowStateHolder.currentMode)
        assertFalse(WindowStateHolder.inPictureInPicture)
        assertFalse(WindowStateHolder.inMultiWindow)
    }
}
