package com.hxz.alerttime.app.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/** Extra brand colors not covered by Material colorScheme. */
object AlertTimeExtras {
    // Gradient stops for the hero timer card (light)
    val HeroGradientStart = Color(0xFF6B8E7B) // Sage Green
    val HeroGradientEnd = Color(0xFF8DB39D)   // Lighter Sage

    // Summary card accent tints (light)
    val AccentTarget = Color(0xFF758591) // Slate
    val AccentPending = Color(0xFFB19B86) // Warm Sand

    // Subject palette — used to tint subject chips / dots
    val SubjectPalette = listOf(
        Color(0xFF6B8E7B), // Sage
        Color(0xFF758591), // Slate
        Color(0xFFB19B86), // Sand
        Color(0xFF5A6B7C), // Deep Slate
        Color(0xFF9CAAA1)  // Muted Sage
    )
}

fun heroGradientBrush(isDark: Boolean): Brush {
    return if (isDark) {
        Brush.verticalGradient(
            colors = listOf(
                Color(0xFF15291E), // Deep OLED Sage
                Color(0xFF1B3124)  // Slightly lighter
            )
        )
    } else {
        Brush.verticalGradient(
            colors = listOf(
                Color(0xFF6B8E7B), // Sage
                Color(0xFF8DB39D)  // Lighter Sage
            )
        )
    }
}
