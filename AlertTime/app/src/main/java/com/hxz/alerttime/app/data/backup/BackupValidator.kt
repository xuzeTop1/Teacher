package com.hxz.alerttime.app.data.backup

import com.hxz.alerttime.app.core.StatusCodes

/**
 * Structural and domain validation for a decoded backup envelope.
 *
 * Runs fully in memory BEFORE any database write. Every problem is collected and
 * returned as a user-readable Chinese message; the caller must abort the restore
 * when any problem exists.
 */
object BackupValidator {

    data class ValidationResult(val errors: List<String>) {
        val isValid: Boolean get() = errors.isEmpty()
    }

    private val taskTypes = setOf(StatusCodes.TYPE_PLAN, 0)
    private val taskStatuses = setOf(StatusCodes.TASK_TODO, StatusCodes.TASK_DONE)
    private val weeklyGoalStatuses = setOf(
        StatusCodes.WEEKLY_GOAL_TODO,
        StatusCodes.WEEKLY_GOAL_DONE,
        StatusCodes.WEEKLY_GOAL_DEFERRED,
        StatusCodes.WEEKLY_GOAL_CANCELED
    )
    private val sessionStatuses = setOf(
        StatusCodes.SESSION_COMPLETED,
        StatusCodes.SESSION_RUNNING
    )
    private val eventTypes = setOf(
        StatusCodes.EVENT_START,
        StatusCodes.EVENT_PAUSE,
        StatusCodes.EVENT_RESUME,
        StatusCodes.EVENT_END,
        StatusCodes.EVENT_DISTRACTION,
        StatusCodes.EVENT_DISTRACTION_APP,
        StatusCodes.EVENT_AI_HELP,
        StatusCodes.EVENT_AI_HELP_ENDED
    )

    fun validate(
        envelope: BackupEnvelopeDto,
        currentDatabaseVersion: Int
    ): ValidationResult {
        val errors = mutableListOf<String>()

        if (envelope.format != BackupProtocol.FORMAT) {
            errors.add("这不是有效的 AlertTime 备份文件")
            return ValidationResult(errors)
        }
        if (envelope.schemaVersion != BackupProtocol.SCHEMA_VERSION) {
            errors.add("不支持的备份协议版本 ${envelope.schemaVersion}（当前支持 ${BackupProtocol.SCHEMA_VERSION}）")
            return ValidationResult(errors)
        }
        // v4 备份向后兼容：v4→v5 只增加了可空列的 ai_help_seconds（旧备份恢复时默认 0），
        // 结构上无损，允许旧版本备份恢复到当前版本。
        // 更早版本（<4）或未来版本（>5）仍拒绝。
        val supportedBackupVersions = setOf(4, currentDatabaseVersion)
        if (envelope.databaseVersion !in supportedBackupVersions) {
            errors.add(
                "备份的数据库版本 ${envelope.databaseVersion} 与当前版本 $currentDatabaseVersion 不一致，" +
                    "暂不支持版本转换，请使用相同版本应用导出的备份"
            )
            return ValidationResult(errors)
        }
        if (envelope.exportedAt <= 0) {
            errors.add("备份的导出时间无效")
        }

        val data = envelope.data
        val missingCollections = listOfNotNull(
            if (data.users == null) "users" else null,
            if (data.subjects == null) "subjects" else null,
            if (data.tasks == null) "tasks" else null,
            if (data.weeklyGoals == null) "weeklyGoals" else null,
            if (data.studySessions == null) "studySessions" else null,
            if (data.studySessionEvents == null) "studySessionEvents" else null,
            if (data.diaries == null) "diaries" else null,
            if (data.appSettings == null) "appSettings" else null
        )
        if (missingCollections.isNotEmpty()) {
            errors.add("备份缺少必需的数据集合 ${missingCollections.joinToString("、")}")
            return ValidationResult(errors)
        }

        // All collections verified non-null above (early return guarantees it);
        // orEmpty() is only a smart-cast workaround and never masks a real null.
        val users = data.users.orEmpty()
        val subjects = data.subjects.orEmpty()
        val tasks = data.tasks.orEmpty()
        val weeklyGoals = data.weeklyGoals.orEmpty()
        val sessions = data.studySessions.orEmpty()
        val events = data.studySessionEvents.orEmpty()
        val diaries = data.diaries.orEmpty()
        val appSettings = data.appSettings.orEmpty()

        checkCollectionSize(errors, "users", users, BackupProtocol.MAX_COLLECTION_SIZE_USERS)
        checkCollectionSize(errors, "subjects", subjects, BackupProtocol.MAX_COLLECTION_SIZE_SUBJECTS)
        checkCollectionSize(errors, "tasks", tasks, BackupProtocol.MAX_COLLECTION_SIZE_TASKS)
        checkCollectionSize(errors, "weeklyGoals", weeklyGoals, BackupProtocol.MAX_COLLECTION_SIZE_WEEKLY_GOALS)
        checkCollectionSize(errors, "studySessions", sessions, BackupProtocol.MAX_COLLECTION_SIZE_SESSIONS)
        checkCollectionSize(errors, "studySessionEvents", events, BackupProtocol.MAX_COLLECTION_SIZE_EVENTS)
        checkCollectionSize(errors, "diaries", diaries, BackupProtocol.MAX_COLLECTION_SIZE_DIARIES)
        checkCollectionSize(errors, "appSettings", appSettings, BackupProtocol.MAX_COLLECTION_SIZE_APP_SETTINGS)

        // --- users ---
        val userIds = HashSet<Long>(users.size)
        users.forEach { user ->
            if (!checkPositiveId(errors, "users", user.id)) return@forEach
            if (!userIds.add(user.id)) {
                errors.add("users 中存在重复的主键 id=${user.id}")
                return@forEach
            }
            checkNonNegativeTime(errors, "users(id=${user.id})", "createdAt", user.createdAt)
            checkNonNegativeTime(errors, "users(id=${user.id})", "updatedAt", user.updatedAt)
            checkOptionalTimestamp(errors, "users(id=${user.id})", "deletedAt", user.deletedAt)
            checkStringLength(errors, "users(id=${user.id})", "nickname", user.nickname)
            checkStringLength(errors, "users(id=${user.id})", "avatarUrl", user.avatarUrl)
        }

        // --- subjects ---
        val subjectIds = HashSet<Long>(subjects.size)
        subjects.forEach { subject ->
            if (!checkPositiveId(errors, "subjects", subject.id)) return@forEach
            if (!subjectIds.add(subject.id)) {
                errors.add("subjects 中存在重复的主键 id=${subject.id}")
                return@forEach
            }
            if (!userIds.contains(subject.userId)) {
                errors.add("subjects(id=${subject.id}) 引用了不存在的用户 id=${subject.userId}")
            }
            checkNonNegative(errors, "subjects(id=${subject.id})", "sortOrder", subject.sortOrder.toLong())
            checkNonNegativeTime(errors, "subjects(id=${subject.id})", "createdAt", subject.createdAt)
            checkNonNegativeTime(errors, "subjects(id=${subject.id})", "updatedAt", subject.updatedAt)
            checkOptionalTimestamp(errors, "subjects(id=${subject.id})", "deletedAt", subject.deletedAt)
            checkStringLength(errors, "subjects(id=${subject.id})", "name", subject.name)
            checkStringLength(errors, "subjects(id=${subject.id})", "color", subject.color)
            checkStringLength(errors, "subjects(id=${subject.id})", "icon", subject.icon)
        }

        // --- tasks ---
        val taskIds = HashSet<Long>(tasks.size)
        tasks.forEach { task ->
            if (!checkPositiveId(errors, "tasks", task.id)) return@forEach
            if (!taskIds.add(task.id)) {
                errors.add("tasks 中存在重复的主键 id=${task.id}")
                return@forEach
            }
            if (!userIds.contains(task.userId)) {
                errors.add("tasks(id=${task.id}) 引用了不存在的用户 id=${task.userId}")
            }
            if (task.subjectId != null && !subjectIds.contains(task.subjectId)) {
                errors.add("tasks(id=${task.id}) 引用了不存在的科目 id=${task.subjectId}")
            }
            if (task.type !in taskTypes) {
                errors.add("tasks(id=${task.id}) 的 type=${task.type} 不受支持")
            }
            if (task.status !in taskStatuses) {
                errors.add("tasks(id=${task.id}) 的 status=${task.status} 不受支持")
            }
            if (task.priority < 0) {
                errors.add("tasks(id=${task.id}) 的 priority 不能为负数")
            }
            if (task.sortOrder < 0) {
                errors.add("tasks(id=${task.id}) 的 sortOrder 不能为负数")
            }
            if (task.targetDurationSeconds != null && task.targetDurationSeconds <= 0) {
                errors.add("tasks(id=${task.id}) 的 targetDurationSeconds 必须大于 0")
            }
            checkOptionalTimestamp(errors, "tasks(id=${task.id})", "dueAt", task.dueAt)
            checkOptionalTimestamp(errors, "tasks(id=${task.id})", "completedAt", task.completedAt)
            checkNonNegativeTime(errors, "tasks(id=${task.id})", "createdAt", task.createdAt)
            checkNonNegativeTime(errors, "tasks(id=${task.id})", "updatedAt", task.updatedAt)
            checkOptionalTimestamp(errors, "tasks(id=${task.id})", "deletedAt", task.deletedAt)
            checkStringLength(errors, "tasks(id=${task.id})", "title", task.title)
            checkStringLength(errors, "tasks(id=${task.id})", "content", task.content)
        }

        // --- weekly goals ---
        val weeklyGoalIds = HashSet<Long>(weeklyGoals.size)
        weeklyGoals.forEach { goal ->
            if (!checkPositiveId(errors, "weeklyGoals", goal.id)) return@forEach
            if (!weeklyGoalIds.add(goal.id)) {
                errors.add("weeklyGoals 中存在重复的主键 id=${goal.id}")
                return@forEach
            }
            if (!userIds.contains(goal.userId)) {
                errors.add("weeklyGoals(id=${goal.id}) 引用了不存在的用户 id=${goal.userId}")
            }
            if (goal.status !in weeklyGoalStatuses) {
                errors.add("weeklyGoals(id=${goal.id}) 的 status=${goal.status} 不受支持")
            }
            checkNonNegativeTime(errors, "weeklyGoals(id=${goal.id})", "weekStart", goal.weekStart)
            checkOptionalTimestamp(errors, "weeklyGoals(id=${goal.id})", "completedAt", goal.completedAt)
            checkOptionalTimestamp(errors, "weeklyGoals(id=${goal.id})", "deferredToWeekStart", goal.deferredToWeekStart)
            checkNonNegativeTime(errors, "weeklyGoals(id=${goal.id})", "createdAt", goal.createdAt)
            checkNonNegativeTime(errors, "weeklyGoals(id=${goal.id})", "updatedAt", goal.updatedAt)
            checkOptionalTimestamp(errors, "weeklyGoals(id=${goal.id})", "deletedAt", goal.deletedAt)
            checkStringLength(errors, "weeklyGoals(id=${goal.id})", "title", goal.title)
            checkStringLength(errors, "weeklyGoals(id=${goal.id})", "successCriteria", goal.successCriteria)
            checkStringLength(errors, "weeklyGoals(id=${goal.id})", "exceptionReason", goal.exceptionReason)
        }

        // --- study sessions ---
        val sessionIds = HashSet<Long>(sessions.size)
        sessions.forEach { session ->
            if (!checkPositiveId(errors, "studySessions", session.id)) return@forEach
            if (!sessionIds.add(session.id)) {
                errors.add("studySessions 中存在重复的主键 id=${session.id}")
                return@forEach
            }
            if (!userIds.contains(session.userId)) {
                errors.add("studySessions(id=${session.id}) 引用了不存在的用户 id=${session.userId}")
            }
            if (session.subjectId != null && !subjectIds.contains(session.subjectId)) {
                errors.add("studySessions(id=${session.id}) 引用了不存在的科目 id=${session.subjectId}")
            }
            if (session.taskId != null && !taskIds.contains(session.taskId)) {
                errors.add("studySessions(id=${session.id}) 引用了不存在的计划 id=${session.taskId}")
            }
            if (session.status !in sessionStatuses) {
                errors.add("studySessions(id=${session.id}) 的 status=${session.status} 不受支持")
            }
            if (session.durationSeconds < 0) {
                errors.add("studySessions(id=${session.id}) 的 durationSeconds 不能为负数")
            }
            if (session.pauseSeconds < 0) {
                errors.add("studySessions(id=${session.id}) 的 pauseSeconds 不能为负数")
            }
            if (session.focusScore != null && (session.focusScore < 0 || session.focusScore > 100)) {
                errors.add("studySessions(id=${session.id}) 的 focusScore 必须在 0 到 100 之间")
            }
            checkNonNegativeTime(errors, "studySessions(id=${session.id})", "startTime", session.startTime)
            checkOptionalTimestamp(errors, "studySessions(id=${session.id})", "endTime", session.endTime)
            if (session.endTime != null && session.endTime < session.startTime) {
                errors.add("studySessions(id=${session.id}) 的结束时间早于开始时间")
            }
            checkNonNegativeTime(errors, "studySessions(id=${session.id})", "createdAt", session.createdAt)
            checkNonNegativeTime(errors, "studySessions(id=${session.id})", "updatedAt", session.updatedAt)
            checkOptionalTimestamp(errors, "studySessions(id=${session.id})", "deletedAt", session.deletedAt)
            checkStringLength(errors, "studySessions(id=${session.id})", "title", session.title)
            checkStringLength(errors, "studySessions(id=${session.id})", "note", session.note)
        }

        // Domain rule: at most one running (unfinished) session can exist at a time.
        val runningCount = sessions.count { it.status == StatusCodes.SESSION_RUNNING && it.deletedAt == null }
        if (runningCount > 1) {
            errors.add("备份中包含 $runningCount 个进行中的学习，同一时间只允许一个")
        }

        // --- study session events ---
        val eventIds = HashSet<Long>(events.size)
        events.forEach { event ->
            if (!checkPositiveId(errors, "studySessionEvents", event.id)) return@forEach
            if (!eventIds.add(event.id)) {
                errors.add("studySessionEvents 中存在重复的主键 id=${event.id}")
                return@forEach
            }
            if (!sessionIds.contains(event.sessionId)) {
                errors.add("studySessionEvents(id=${event.id}) 引用了不存在的学习记录 id=${event.sessionId}")
            }
            if (event.eventType !in eventTypes) {
                errors.add("studySessionEvents(id=${event.id}) 的 eventType=${event.eventType} 不受支持")
            }
            checkNonNegativeTime(errors, "studySessionEvents(id=${event.id})", "eventTime", event.eventTime)
            checkNonNegativeTime(errors, "studySessionEvents(id=${event.id})", "createdAt", event.createdAt)
            checkStringLength(
                errors,
                "studySessionEvents(id=${event.id})",
                "eventDetail",
                event.eventDetail,
                BackupProtocol.MAX_EVENT_DETAIL_LENGTH
            )
        }

        // --- diaries ---
        val diaryIds = HashSet<Long>(diaries.size)
        diaries.forEach { diary ->
            if (!checkPositiveId(errors, "diaries", diary.id)) return@forEach
            if (!diaryIds.add(diary.id)) {
                errors.add("diaries 中存在重复的主键 id=${diary.id}")
                return@forEach
            }
            if (!userIds.contains(diary.userId)) {
                errors.add("diaries(id=${diary.id}) 引用了不存在的用户 id=${diary.userId}")
            }
            checkNonNegativeTime(errors, "diaries(id=${diary.id})", "diaryDate", diary.diaryDate)
            checkNonNegativeTime(errors, "diaries(id=${diary.id})", "createdAt", diary.createdAt)
            checkNonNegativeTime(errors, "diaries(id=${diary.id})", "updatedAt", diary.updatedAt)
            checkOptionalTimestamp(errors, "diaries(id=${diary.id})", "deletedAt", diary.deletedAt)
            checkStringLength(errors, "diaries(id=${diary.id})", "title", diary.title)
            checkStringLength(errors, "diaries(id=${diary.id})", "content", diary.content)
            if (diary.mood != null && diary.mood < 0) {
                errors.add("diaries(id=${diary.id}) 的 mood 不能为负数")
            }
        }

        // --- app settings ---
        val settingKeys = HashSet<String>(appSettings.size)
        appSettings.forEach { setting ->
            if (setting.key.isBlank() || setting.key.length > BackupProtocol.MAX_KEY_LENGTH) {
                errors.add("appSettings 中存在无效的 key")
                return@forEach
            }
            if (!BackupRepository.isBackupEligibleAppSetting(setting.key)) {
                // 设备绑定/同步运行时状态和设备级 Provider 配置不允许出现在备份文件中；
                // 本应用导出时已过滤，出现即视为外部/旧备份，fail-closed 拒绝整批恢复。
                errors.add("appSettings 包含不允许的设备敏感配置 key=${setting.key}")
                return@forEach
            }
            if (!settingKeys.add(setting.key)) {
                errors.add("appSettings 中存在重复的 key=${setting.key}")
                return@forEach
            }
            if (setting.value.length > BackupProtocol.MAX_APP_SETTING_VALUE_LENGTH) {
                errors.add("appSettings(key=${setting.key}) 的值长度超过上限 ${BackupProtocol.MAX_APP_SETTING_VALUE_LENGTH}")
            }
            checkNonNegativeTime(errors, "appSettings(key=${setting.key})", "updatedAt", setting.updatedAt)
        }

        return ValidationResult(errors)
    }

    // --- helpers ---

    private fun checkCollectionSize(
        errors: MutableList<String>,
        collection: String,
        items: List<*>,
        max: Int
    ) {
        if (items.size > max) {
            errors.add("$collection 数量超过上限 $max")
        }
    }

    private fun checkPositiveId(errors: MutableList<String>, collection: String, id: Long): Boolean {
        if (id <= 0) {
            errors.add("$collection 中存在非法的主键 id=$id")
            return false
        }
        return true
    }

    private fun checkNonNegative(errors: MutableList<String>, owner: String, field: String, value: Long) {
        if (value < 0) errors.add("$owner 的 $field 不能为负数")
    }

    private fun checkNonNegativeTime(errors: MutableList<String>, owner: String, field: String, value: Long) {
        if (value < 0) errors.add("$owner 的 $field 无效")
    }

    private fun checkOptionalTimestamp(errors: MutableList<String>, owner: String, field: String, value: Long?) {
        if (value != null && value < 0) errors.add("$owner 的 $field 无效")
    }

    private fun checkStringLength(
        errors: MutableList<String>,
        owner: String,
        field: String,
        value: String?,
        max: Int = BackupProtocol.MAX_STRING_LENGTH
    ) {
        if (value != null && value.length > max) {
            errors.add("$owner 的 $field 长度超过上限 $max")
        }
    }
}
