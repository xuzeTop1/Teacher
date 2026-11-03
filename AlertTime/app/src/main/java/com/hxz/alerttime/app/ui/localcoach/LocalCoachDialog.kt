package com.hxz.alerttime.app.ui.localcoach

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.data.localmodel.CoachTask
import com.hxz.alerttime.app.data.localmodel.LocalCoachContract

@Composable
fun LocalCoachDialog(
    onDismiss: () -> Unit,
    initialTask: CoachTask = CoachTask.Factors,
    initialText: String = "",
    viewModel: LocalCoachViewModel = viewModel()
) {
    var task by rememberSaveable(initialTask) { mutableStateOf(initialTask) }
    // The user-entered reflection and generated output stay in memory; no saved-instance backup.
    var text by remember(initialTask, initialText) { mutableStateOf(initialText) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.clearResult() }
    DisposableEffect(Unit) { onDispose { viewModel.cancel(); viewModel.clearResult() } }
    AlertDialog(
        onDismissRequest = { if (!state.busy) onDismiss() },
        title = { Text("本地学习助手") },
        text = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Qwen 0.5B · 离线分析\n只处理你在这里确认的文字，无需 API Key。", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    CoachTask.entries.forEach { option ->
                        FilterChip(
                            selected = task == option,
                            enabled = !state.busy,
                            onClick = { task = option; viewModel.clearResult() },
                            label = { Text(option.label) }
                        )
                    }
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it; viewModel.clearResult() },
                    enabled = !state.busy,
                    label = { Text(when (task) {
                        CoachTask.Factors -> "本次学习情况"
                        CoachTask.Create -> "计划内容、当日总时长与目标"
                        CoachTask.Delete -> "计划内容与调整原因"
                    }) },
                    supportingText = { Text("${text.length}/${LocalCoachContract.MAX_INPUT_CHARS}") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
                if (state.busy) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("正在本机分析，首次准备模型需要一些时间。", style = MaterialTheme.typography.bodySmall)
                }
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                state.result?.let {
                    Text("模型推断 · 仅供参考", style = MaterialTheme.typography.labelLarge)
                    Text(it.summary)
                }
                Text("建议不会自动修改计划、专注记录或掌握度。首次运行需额外约 400 MB 可用空间。", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !state.busy && text.isNotBlank() && text.length <= LocalCoachContract.MAX_INPUT_CHARS,
                onClick = { viewModel.analyze(task, text) }
            ) { Text("本地分析") }
        },
        dismissButton = {
            TextButton(onClick = { if (state.busy) viewModel.cancel() else onDismiss() }) {
                Text(if (state.busy) "取消分析" else "关闭")
            }
        }
    )
}
