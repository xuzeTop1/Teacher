package com.hxz.alerttime.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF6B8E7B), // Sage Green
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE4F0E8),
    onPrimaryContainer = Color(0xFF1B3124),
    secondary = Color(0xFF758591), // Slate
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE5EDF4),
    onSecondaryContainer = Color(0xFF1E2830),
    tertiary = Color(0xFFB19B86), // Warm sand
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF3E7DB),
    onTertiaryContainer = Color(0xFF382A1B),
    background = Color(0xFFFBFDFA), // Clean off-white
    onBackground = Color(0xFF191C1A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF191C1A),
    surfaceVariant = Color(0xFFEBEFEA),
    onSurfaceVariant = Color(0xFF4A524D),
    outline = Color(0xFFBCC4BF),
    outlineVariant = Color(0xFFD8DFDA),
    // M3 tonal surface roles：必须显式覆盖，否则回退到 Material3 基线紫色板，
    // 导致 AlertDialog（surfaceContainerHigh）与卡片（surfaceContainerLow）发紫。
    surfaceDim = Color(0xFFDBDFDB),
    surfaceBright = Color(0xFFFBFDFA),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF5F8F4),
    surfaceContainer = Color(0xFFF0F3EE),
    surfaceContainerHigh = Color(0xFFEAEEE8),
    surfaceContainerHighest = Color(0xFFE4E8E3),
    inverseSurface = Color(0xFF2E312F),
    inverseOnSurface = Color(0xFFEFF1ED),
    inversePrimary = Color(0xFF9EC9AE),
    error = Color(0xFFBA1A1A),
    onError = Color.White
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8DB39D),
    onPrimary = Color(0xFF0F3120),
    primaryContainer = Color(0xFF234C37),
    onPrimaryContainer = Color(0xFFC7EBD4),
    secondary = Color(0xFF90A3B1),
    onSecondary = Color(0xFF1D2B36),
    secondaryContainer = Color(0xFF334451),
    onSecondaryContainer = Color(0xFFC9DEF0),
    tertiary = Color(0xFFCDAF92),
    onTertiary = Color(0xFF3A2411),
    tertiaryContainer = Color(0xFF553924),
    onTertiaryContainer = Color(0xFFF3E7DB),
    background = Color(0xFF0E1210), // Deep slate OLED black
    onBackground = Color(0xFFDFE4E0),
    surface = Color(0xFF151917),
    onSurface = Color(0xFFDFE4E0),
    surfaceVariant = Color(0xFF3A443E),
    onSurfaceVariant = Color(0xFFBCC4BF),
    outline = Color(0xFF66716A),
    outlineVariant = Color(0xFF3A443E),
    // 同浅色：tonal surface 角色不覆盖会露出基线紫色。
    surfaceDim = Color(0xFF0E1210),
    surfaceBright = Color(0xFF2F3430),
    surfaceContainerLowest = Color(0xFF090D0B),
    surfaceContainerLow = Color(0xFF171C19),
    surfaceContainer = Color(0xFF1B211D),
    surfaceContainerHigh = Color(0xFF262B27),
    surfaceContainerHighest = Color(0xFF303531),
    inverseSurface = Color(0xFFDFE4E0),
    inverseOnSurface = Color(0xFF2E312F),
    inversePrimary = Color(0xFF6B8E7B),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005)
)


@Composable
fun AlertTimeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AlertTimeTypography,
        shapes = AlertTimeShapes,
        content = content
    )
}
