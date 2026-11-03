package com.hxz.alerttime.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

private val SectionSpacing = 20.dp
private val FieldSpacing = 10.dp

/**
 * 对话框表单的统一骨架：分节标题 + 说明 + 字段行，纵向间距由这里统一决定。
 * 各对话框原先手写 Text + Spacer + Divider，间距和层级互不一致；并排字段还常因
 * 标签过长换行而错位。新增表单请复用这些组件，不要再逐处调 dp。
 *
 * 注意：这里只做滚动和间距，不设 heightIn —— 外层 AlertDialog 已约束高度，
 * 再套一层受限滚动会把超出部分的子项压成 0 高度（实测按钮不可点）。
 */
@Composable
fun FormScrollColumn(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(SectionSpacing),
        content = content
    )
}

/** 表单分节：标题 + 可选说明 + 组内字段。 */
@Composable
fun FormSection(
    title: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(FieldSpacing)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            caption?.let { FormCaption(it) }
        }
        content()
    }
}

/** 说明性小字。统一字号与默认次级色，避免每个调用点重复写 style/color。 */
@Composable
fun FormCaption(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodySmall,
        color = color
    )
}

/**
 * 左标签 / 右开关的行。[control] 放在开关左侧（如「20 分」输入框）。
 * 标签列占 weight(1f)，长标签换行时只挤压自己，不会把输入框推歪。
 */
@Composable
fun FormSwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    control: (@Composable () -> Unit)? = null
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            supporting?.let { FormCaption(it) }
        }
        control?.invoke()
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

/**
 * 「20 分」这类窄数字输入框。宽度固定，长标签不会把它压到换行；
 * 输入统一按数字过滤，因此调用点不用各自写 filter/take。
 */
@Composable
fun FormNumberField(
    value: String,
    onValueChange: (String) -> Unit,
    suffix: String,
    modifier: Modifier = Modifier,
    maxDigits: Int = 3
) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValueChange(it.filter(Char::isDigit).take(maxDigits)) },
        modifier = modifier.width(96.dp),
        suffix = { Text(suffix, style = MaterialTheme.typography.bodySmall) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyMedium
    )
}

/** 「22:30」这类 HH:mm 输入框。 */
@Composable
fun FormTimeField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValueChange(it.take(5)) },
        modifier = modifier,
        label = { Text(label) },
        singleLine = true
    )
}

/** 等宽按钮行：按钮自己带 Modifier.weight(1f)，避免按文字宽度排布。 */
@Composable
fun FormButtonRow(
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content
    )
}