package com.hxz.alerttime.app

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.hxz.alerttime.app.core.window.WindowStateHolder
import com.hxz.alerttime.app.ui.AlertTimeApp
import com.hxz.alerttime.app.ui.theme.AlertTimeTheme

/**
 * 主 Activity：负责窗口状态上报（画中画 / 分屏 / 配置变化），
 * 不持有业务逻辑。窗口状态统一写入 [WindowStateHolder]，
 * 生命周期观察者（AlertTimeApp）与计时器只读使用。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val database = (application as AlertTimeApplication).database
        WindowStateHolder.update(this)
        setContent {
            AlertTimeTheme {
                AlertTimeApp(database = database)
            }
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        WindowStateHolder.update(this)
    }

    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        WindowStateHolder.update(this)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // 旋转 / 屏幕尺寸 / 字体缩放等配置变化：只更新窗口状态，
        // 不重建 Activity，避免产生假的 ON_STOP 分心记录。
        WindowStateHolder.update(this)
    }
}
