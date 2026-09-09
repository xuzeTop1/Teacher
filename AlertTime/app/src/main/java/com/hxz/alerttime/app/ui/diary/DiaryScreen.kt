package com.hxz.alerttime.app.ui.diary

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material.icons.filled.SentimentNeutral
import androidx.compose.material.icons.filled.SentimentSatisfied
import androidx.compose.material.icons.filled.SentimentVeryDissatisfied
import androidx.compose.material.icons.filled.SentimentVerySatisfied
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import com.hxz.alerttime.app.ui.components.AppPageHeader
import com.hxz.alerttime.app.ui.components.FormBottomSheet
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiaryScreen(
    database: AlertTimeDatabase,
    modifier: Modifier = Modifier,
    viewModel: DiaryViewModel = viewModel(factory = DiaryViewModel.Factory(database))
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showEditor by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(uiState.errorMessage) {
        val message = uiState.errorMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearError()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            AppPageHeader(
                title = "日记",
                subtitle = "记录复盘、心情和每天学到的东西。"
            ) {
                TextButton(onClick = { showEditor = true }) {
                    Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("新建")
                }
            }

            if (uiState.diaries.isEmpty() && !uiState.isLoading) {
                EmptyDiaryState(modifier = Modifier.weight(1f))
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(uiState.diaries, key = { it.id }) { diary ->
                        DiaryCard(
                            diary = diary,
                            onClick = { viewModel.startEditing(diary) },
                            onDelete = { viewModel.requestDelete(diary) }
                        )
                    }
                    item { Spacer(Modifier.height(12.dp)) }
                }
            }
        }
    }

    if (showEditor) {
        DiaryEditorDialog(
            isSaving = uiState.isSavingDiary,
            onDismiss = { showEditor = false },
            onSave = { title, content, mood ->
                viewModel.addDiary(
                    title = title,
                    content = content,
                    mood = mood,
                    onSuccess = { showEditor = false }
                )
            }
        )
    }

    uiState.editingDiary?.let { diary ->
        DiaryEditorDialog(
            initialTitle = diary.title ?: "",
            initialContent = diary.content,
            initialMood = diary.mood ?: 3,
            dialogTitle = "编辑日记",
            isSaving = uiState.isSavingDiary,
            onDismiss = { viewModel.cancelEditing() },
            onSave = { title, content, mood ->
                viewModel.updateDiary(
                    diaryId = diary.id,
                    title = title,
                    content = content,
                    mood = mood
                )
            }
        )
    }

    uiState.deleteConfirmDiary?.let { diary ->
        AlertDialog(
            onDismissRequest = { viewModel.cancelDelete() },
            title = { Text("确认删除") },
            text = { Text("确定要删除这篇日记吗？此操作无法撤销。") },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteDiary(diary.id) }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelDelete() }) {
                    Text("取消")
                }
            }
        )
    }
}

@Composable
private fun EmptyDiaryState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.secondaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Filled.AutoStories,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.size(36.dp)
                )
            }
            Text(
                text = "还没有日记",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "点击右下角写下今天的学习感悟和心情。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DiaryCard(
    diary: DiaryEntity,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    androidx.compose.material3.Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow
    ) {
        Column(
            modifier = Modifier.padding(start = 14.dp, top = 12.dp, bottom = 12.dp, end = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Filled.CalendarToday,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = formatDiaryDate(diary.diaryDate),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    diary.mood?.let { mood ->
                        MoodChip(mood = mood)
                    }
                    IconButton(
                        onClick = onDelete,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            Icons.Filled.Delete,
                            contentDescription = "删除日记",
                            tint = MaterialTheme.colorScheme.error.copy(alpha = 0.7f),
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }

            if (!diary.title.isNullOrBlank()) {
                Text(
                    text = diary.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                text = diary.content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun MoodChip(mood: Int) {
    val text = when (mood) {
        1 -> "较差"
        2 -> "一般"
        3 -> "良好"
        4 -> "很好"
        else -> "未设置"
    }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.tertiaryContainer)
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Filled.Mood,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.size(14.dp)
            )
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiaryEditorDialog(
    initialTitle: String = "",
    initialContent: String = "",
    initialMood: Int = 3,
    dialogTitle: String = "写日记",
    isSaving: Boolean,
    onDismiss: () -> Unit,
    onSave: (String?, String, Int?) -> Unit
) {
    var title by rememberSaveable { mutableStateOf(initialTitle) }
    var content by rememberSaveable { mutableStateOf(initialContent) }
    var mood by rememberSaveable { mutableIntStateOf(initialMood) }

    FormBottomSheet(
        title = dialogTitle,
        subtitle = "写下学习复盘和当下感受",
        confirmLabel = "保存日记",
        confirmEnabled = content.isNotBlank(),
        isSubmitting = isSaving,
        onDismiss = onDismiss,
        onConfirm = { onSave(title.trim().ifBlank { null }, content.trim(), mood) }
    ) {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it.take(120) },
            label = { Text("标题（可选）") },
            placeholder = { Text("一句话概括今天") },
            supportingText = { Text("${title.length}/120") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = content,
            onValueChange = { content = it.take(4_000) },
            label = { Text("复盘正文") },
            placeholder = { Text("学到了什么？哪里卡住了？下一步准备怎么做？") },
            supportingText = {
                Text(
                    if (content.isBlank()) "至少写一句才能保存" else "${content.length}/4000"
                )
            },
            minLines = 5,
            maxLines = 10,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        )

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "今日心情",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            MoodSelector(
                selectedMood = mood,
                onSelectMood = { mood = it }
            )
        }
    }
}

@Composable
private fun MoodSelector(
    selectedMood: Int,
    onSelectMood: (Int) -> Unit
) {
    val moods = listOf(
        MoodOption(1, "较差", Icons.Filled.SentimentVeryDissatisfied),
        MoodOption(2, "一般", Icons.Filled.SentimentNeutral),
        MoodOption(3, "良好", Icons.Filled.SentimentSatisfied),
        MoodOption(4, "很好", Icons.Filled.SentimentVerySatisfied)
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        moods.forEach { option ->
            val isSelected = selectedMood == option.value
            val containerColor = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            val contentColor = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onSelectMood(option.value) }
                    .background(containerColor)
                    .padding(vertical = 9.dp)
            ) {
                Icon(
                    option.icon,
                    contentDescription = option.label,
                    tint = contentColor,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = option.label,
                    style = MaterialTheme.typography.labelSmall,
                    color = contentColor,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium
                )
            }
        }
    }
}

private data class MoodOption(
    val value: Int,
    val label: String,
    val icon: ImageVector
)

private fun formatDiaryDate(epochMillis: Long): String {
    val date = Instant.ofEpochMilli(epochMillis)
        .atZone(ZoneId.systemDefault())
        .toLocalDate()
    return date.format(DateTimeFormatter.ofPattern("yyyy年M月d日"))
}
