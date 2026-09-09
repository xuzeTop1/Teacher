package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.llm.LlmProviderSettingsStore
import com.hxz.alerttime.app.data.llm.LlmCompletionClient
import com.hxz.alerttime.app.data.llm.LlmFailureCategory
import com.hxz.alerttime.app.data.llm.LlmProviderException
import com.hxz.alerttime.app.data.llm.LlmTimeoutPolicy
import com.hxz.alerttime.app.data.llm.MAX_LLM_PROMPT_CHARS
import com.hxz.alerttime.app.data.llm.OpenAiCompatibleClient
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import com.hxz.alerttime.app.data.sync.SyncLearningFactDto
import com.hxz.alerttime.app.data.sync.SyncLearningProfileDto
import com.hxz.alerttime.app.data.sync.SyncLearningInputSummaryDto
import com.hxz.alerttime.app.data.sync.SyncAssessmentDraftDto
import com.hxz.alerttime.app.data.sync.SyncAssessmentDraftQuestionDto
import com.hxz.alerttime.app.data.sync.SyncPlanEvaluationDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import com.hxz.alerttime.app.data.sync.SyncTaskDto
import com.hxz.alerttime.app.data.sync.SyncCodec
import com.hxz.alerttime.app.data.sync.AssessmentAnswerLeakGuard
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.LearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.LEARNING_ANALYSIS_AGGREGATE_EVIDENCE_REFS
import com.hxz.alerttime.app.data.sync.LEARNING_ANALYSIS_USER_SETTING_EVIDENCE_REFS
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.IOException
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import java.util.UUID

class LearningAnalysisService(
    private val providerStore: LlmProviderSettingsStore,
    private val learnerContextStore: LearnerContextStore = EmptyLearnerContextStore,
    private val llmClient: LlmCompletionClient = OpenAiCompatibleClient(
        timeoutPolicy = LlmTimeoutPolicy.DEFAULT
    ),
    private val now: () -> Long = { System.currentTimeMillis() },
    private val zoneId: ZoneId = ZoneId.systemDefault(),
    private val fallbackGenerator: LearningAnalysisGenerator =
        DeterministicLearningAnalysisGenerator(zoneId, now),
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false }
) : LearningAnalysisGenerator {
    override suspend fun generate(snapshotId: String, snapshot: SyncSnapshotPayload): SyncLearningAnalysisDto {
        require(snapshotId.isNotBlank()) { "snapshotId must not be blank" }
        val learnerContext = try {
            learnerContextStore.load()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            LearnerContext()
        }
        val baseline = applyLearnerContext(
            fallbackGenerator.generate(snapshotId, snapshot),
            learnerContext
        )
        val settings = try {
            providerStore.load()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            null
        } ?: return baseline
        // baseline.generatedAt 是本次生成的唯一时刻。Provider 响应即使跨过午夜，输入范围和
        // 最终结果也仍属于发起生成时的同一手机本地日期，不能在一次分析内跨日漂移。
        val generatedAt = baseline.generatedAt
        val input = AnalysisInput.from(snapshot, learnerContext, generatedAt, zoneId)
        // 结果摘要必须来自本次已构建的 AnalysisInput，不能为 UI 再次查询 Room 或重新筛选快照。
        val baselineWithInput = baseline.copy(inputSummary = input.inputSummary)
        val prompt = try {
            input.toPromptJson()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            return fallbackWithWarning(baselineWithInput, error)
        }
        return try {
            val raw = llmClient.complete(settings, LearningAnalysisPrompt.SYSTEM, prompt)
            val result = parseLlmResult(snapshotId, generatedAt, raw, baselineWithInput, input.taskReferences)
            // 在进入 Coordinator 前复用正式协议校验；模型的超长、超量或非法输出一律降级。
            outputStage(LlmFailureCategory.OUTPUT_PROTOCOL) {
                SyncCodec.validateSnapshotForId(snapshot.copy(learningAnalysis = result), snapshotId)
            }
            result
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            fallbackWithWarning(baselineWithInput, error)
        }
    }

    private fun fallbackWithWarning(
        baseline: SyncLearningAnalysisDto,
        error: Throwable
    ): SyncLearningAnalysisDto = baseline.copy(
        warnings = (baseline.warnings + "llm_fallback_${safeFailureCategory(error)}").distinct()
    )

    /** 只返回稳定的安全分类；不得把 provider 响应、URL、Key 或学习记录带入同步 warning。 */
    private fun safeFailureCategory(error: Throwable): String = when (error) {
        is LearningAnalysisRequestTooLargeException -> "request_too_large"
        is LlmProviderException -> error.category.warningCode
        is IOException -> "timeout_network"
        else -> LlmFailureCategory.OUTPUT_VALIDATION.warningCode
    }

    /** 用户填写的目标是声明事实，不允许被模型覆盖，也不能由学习时长推导。 */
    private fun applyLearnerContext(
        baseline: SyncLearningAnalysisDto,
        context: LearnerContext
    ): SyncLearningAnalysisDto {
        if (context.isEmpty()) return baseline
        val contextFacts = buildList {
            if (context.purpose.isNotBlank()) {
                add(contextFact("learner_purpose", "学习目的", JsonPrimitive(context.purpose), "purpose"))
            }
            if (context.examName.isNotBlank()) {
                add(contextFact("exam_name", "考试或项目", JsonPrimitive(context.examName), "examName"))
            }
            if (context.focusSubjects.isNotEmpty()) {
                add(
                    contextFact(
                        "focus_subjects",
                        "考试或重点科目",
                        JsonArray(context.focusSubjects.map(::JsonPrimitive)),
                        "focusSubjects"
                    )
                )
            }
            if (context.targetDate.isNotBlank()) {
                add(contextFact("target_date", "目标日期", JsonPrimitive(context.targetDate), "targetDate"))
            }
        }
        val contextCodes = contextFacts.map { it.code }.toSet()
        val facts = baseline.profile.facts.filterNot { it.code in contextCodes } + contextFacts

        val remainingQuestionSlots = (MAX_QUESTIONS - baseline.assessmentDraft.questions.size)
            .coerceAtLeast(0)
            .coerceAtMost(3)
        val contextQuestions = context.focusSubjects.take(remainingQuestionSlots).mapIndexed { index, subject ->
            SyncAssessmentDraftQuestionDto(
                questionId = "${baseline.analysisId}-ctx-${index + 1}",
                type = "concept_check",
                prompt = "请用自己的话说明“${subject.take(80)}”目前的学习重点或薄弱点，并指出一个你最想验证是否真正掌握的地方。",
                rationale = "根据用户填写的考试科目生成范围确认题，不提供答案，也不直接计入掌握度。",
                rubric = listOf("说明该科目的学习重点或薄弱点", "指出一个待验证的理解点")
            )
        }
        val contextScope = buildList {
            context.purpose.takeIf(String::isNotBlank)?.let { add("目的：$it") }
            context.examName.takeIf(String::isNotBlank)?.let { add("考试：$it") }
            if (context.focusSubjects.isNotEmpty()) add("科目：${context.focusSubjects.joinToString("、")}")
            context.targetDate.takeIf(String::isNotBlank)?.let { add("日期：$it") }
        }.joinToString("；")
        val scope = listOf(baseline.assessmentDraft.scopeSummary, contextScope)
            .filter(String::isNotBlank)
            .joinToString("；")
            .take(MAX_TEXT)

        return baseline.copy(
            profile = baseline.profile.copy(facts = facts),
            assessmentDraft = baseline.assessmentDraft.copy(
                scopeSummary = scope,
                questions = baseline.assessmentDraft.questions + contextQuestions
            )
        )
    }

    private fun contextFact(
        code: String,
        label: String,
        value: kotlinx.serialization.json.JsonElement,
        field: String
    ) = SyncLearningFactDto(
        code = code,
        label = label,
        value = value,
        evidenceRefs = listOf("user_setting:$field")
    )

    private fun parseLlmResult(
        snapshotId: String,
        generatedAt: Long,
        raw: String,
        baseline: SyncLearningAnalysisDto,
        taskReferences: List<TaskReference>
    ): SyncLearningAnalysisDto {
        val payload = extractJsonPayload(raw)
        val root = try {
            json.parseToJsonElement(payload)
        } catch (_: kotlinx.serialization.SerializationException) {
            throw LlmProviderException(
                LlmFailureCategory.RESPONSE_NON_JSON,
                "LLM assistant content is not one JSON object"
            )
        }
        if (root is JsonPrimitive && !isStrictJsonPrimitivePayload(payload)) {
            throw LlmProviderException(
                LlmFailureCategory.RESPONSE_NON_JSON,
                "LLM assistant content is not valid JSON"
            )
        }
        if (root !is JsonObject) {
            throw LlmOutputFailure.exception(LlmFailureCategory.OUTPUT_ROOT_SHAPE)
        }
        if (AssessmentAnswerLeakGuard.findForbiddenQuestionKey(root) != null) {
            throw LlmOutputFailure.exception(LlmFailureCategory.OUTPUT_ANSWER_GUARD)
        }
        val model = outputStage(LlmFailureCategory.OUTPUT_SCHEMA) {
            json.decodeFromJsonElement(LlmAnalysisOutput.serializer(), root)
        }
        outputStage(LlmFailureCategory.OUTPUT_CONSTRAINTS) { validate(model) }
        val analysisId = UUID.randomUUID().toString()
        val masteryFiltered = model.profile.inferences.filterNot { isTimeBasedMasteryInference(it.statement) }
        val rejectedMasteryInference = masteryFiltered.size != model.profile.inferences.size
        val safeInferences = masteryFiltered.map { inference ->
            inference.copy(
                evidenceRefs = inference.evidenceRefs.mapNotNull { resolveEvidenceRef(it, taskReferences) }.distinct()
            )
        }
        val rejectedEvidenceRef = masteryFiltered.zip(safeInferences).any { (before, after) ->
            before.evidenceRefs != after.evidenceRefs
        }
        val assessmentDraft = outputStage(LlmFailureCategory.OUTPUT_TASK_BINDING) {
            val mappedQuestions = model.assessmentDraft.questions.mapIndexed { index, question ->
                // concept_check/diagnostic 必须明确绑定本次今日计划；只有通用 reflection
                // 可以省略 sourceTaskIndex。任何一题违规都让整次模型输出降级，不能保留游离题。
                require(question.type == "reflection" || question.sourceTaskIndex != null)
                val taskReference = question.sourceTaskIndex?.let(taskReferences::getOrNull)
                require(question.sourceTaskIndex == null || taskReference != null)
                SyncAssessmentDraftQuestionDto(
                    questionId = localQuestionId(analysisId, index),
                    subjectRemoteId = taskReference?.subjectRemoteId,
                    taskRemoteId = taskReference?.taskRemoteId,
                    type = question.type,
                    prompt = question.prompt,
                    rationale = question.rationale,
                    rubric = question.rubric
                )
            }
            if (mappedQuestions.isEmpty()) {
                baseline.assessmentDraft
            } else {
                // 模型只看到 0-based 本地任务索引，不接触 remoteId。关联由手机按本次今日计划重建。
                // 有今日任务时，至少一题必须成功绑定，否则整次 LLM 输出降级，不能产生“看似相关”的游离题。
                require(taskReferences.isEmpty() || mappedQuestions.any { it.taskRemoteId != null })
                SyncAssessmentDraftDto(
                    status = "draft",
                    scopeSummary = model.assessmentDraft.scopeSummary,
                    questions = mappedQuestions
                )
            }.also { require(it.questions.isNotEmpty()) }
        }
        val warnings = buildList {
            addAll(baseline.warnings)
            addAll(model.warnings)
            if (rejectedMasteryInference) add("llm_time_based_mastery_inference_rejected")
            if (rejectedEvidenceRef) add("llm_untrusted_evidence_ref_rejected")
        }.distinct()
        return SyncLearningAnalysisDto(
            analysisId = analysisId,
            sourceSnapshotId = snapshotId,
            generatedAt = generatedAt,
            promptVersion = LEARNING_ANALYSIS_PROMPT_VERSION,
            generator = "android_llm",
            profile = model.profile.copy(
                facts = baseline.profile.facts,
                inferences = safeInferences
            ),
            planEvaluation = model.planEvaluation,
            assessmentDraft = assessmentDraft,
            warnings = warnings,
            inputSummary = baseline.inputSummary
        )
    }

    /** 只接受纯 JSON 或一个完整的 ```json 代码块；根类型由后续阶段单独判定。 */
    private fun extractJsonPayload(raw: String): String {
        val trimmed = raw.trim()
        if (!trimmed.startsWith("```")) return trimmed
        return MARKDOWN_JSON_BLOCK.matchEntire(trimmed)?.groupValues?.get(1)?.trim()
            ?: throw LlmProviderException(
                LlmFailureCategory.RESPONSE_NON_JSON,
                "LLM output must be one JSON object"
            )
    }

    private fun isStrictJsonPrimitivePayload(payload: String): Boolean =
        (payload.startsWith('"') && payload.endsWith('"')) ||
            payload in JSON_LITERAL_VALUES ||
            JSON_NUMBER.matchEntire(payload) != null

    private fun validate(model: LlmAnalysisOutput) {
        require(model.planEvaluation.verdict in VERDICTS)
        require(model.planEvaluation.score == null || model.planEvaluation.score in 0.0..100.0)
        require(model.assessmentDraft.status == "draft")
        require(model.assessmentDraft.scopeSummary.trim().isNotEmpty())
        model.profile.inferences.forEach { require(it.confidence in 0.0..1.0) }
        model.planEvaluation.dimensions.forEach { require(it.score == null || it.score in 0.0..100.0) }
        model.assessmentDraft.questions.forEach {
            require(it.type in QUESTION_TYPES && it.prompt.isNotBlank())
            require(it.rationale.isNotBlank())
            require(it.prompt.length <= MAX_TEXT && it.rationale.length <= MAX_TEXT)
            require(it.rubric.all(String::isNotBlank))
        }
        require(model.assessmentDraft.questions.size <= MAX_QUESTIONS)
        require(model.assessmentDraft.scopeSummary.length <= MAX_TEXT)
    }

    private inline fun <T> outputStage(
        category: LlmFailureCategory,
        block: () -> T
    ): T = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        throw LlmOutputFailure.exception(category)
    }

    private fun localQuestionId(analysisId: String, index: Int): String = "$analysisId-${index + 1}"

    /** 模型只能引用 Prompt 中的稳定别名；真实任务 remoteId 仅由手机本地映射。 */
    private fun resolveEvidenceRef(value: String, taskReferences: List<TaskReference>): String? {
        val normalized = value.trim()
        if (normalized in LEARNING_ANALYSIS_AGGREGATE_EVIDENCE_REFS) return normalized
        if (normalized in LEARNING_ANALYSIS_USER_SETTING_EVIDENCE_REFS) return normalized
        val index = normalized.removePrefix("task_index:").takeIf { normalized.startsWith("task_index:") }
            ?.toIntOrNull() ?: return null
        return taskReferences.getOrNull(index)?.let { "task:${it.taskRemoteId}" }
    }

    private fun isTimeBasedMasteryInference(statement: String): Boolean {
        val normalized = statement.lowercase()
        return TIME_EVIDENCE_TERMS.any(normalized::contains) && MASTERY_TERMS.any(normalized::contains)
    }

    private data class AnalysisInput(
        val learnerContext: LearnerContextInput,
        val scope: AnalysisScope,
        val subjects: List<Subject>,
        val goals: List<Goal>,
        val tasks: List<Task>,
        val sessions: List<Session>,
        val taskReferences: List<TaskReference>
    ) {
        /** 与本次 Prompt 序列化使用的同一组已过滤数组保持一致。 */
        val inputSummary: SyncLearningInputSummaryDto
            get() = SyncLearningInputSummaryDto(
                subjectCount = subjects.size,
                weeklyGoalCount = goals.size,
                taskCount = tasks.size,
                completedSessionCount = sessions.size,
                source = SyncLearningInputSummaryDto.SOURCE_SAME_ANALYSIS_INPUT_V1
            )

        fun toPromptJson(): String {
            // durationSeconds 已是有效专注；pauseSeconds 单独用于负荷分析，不能重复扣减。
            val focus = sessions.sumOf { it.durationSeconds.coerceAtLeast(0) }
            val pause = sessions.sumOf { it.pauseSeconds.coerceAtLeast(0) }
            val days = sessions.mapNotNull { it.studyDate.takeIf(String::isNotBlank) }.distinct().size
            val distribution = sessions.map { it.subject }.filter { it.isNotBlank() }.groupingBy { it }.eachCount()
            val summary = SessionSummary(sessions.size, focus, pause, days, distribution)
            val serialized = jsonForPrompt.encodeToString(
                SanitizedInput.serializer(),
                SanitizedInput(
                    learnerContext = learnerContext,
                    scope = scope,
                    subjects = subjects,
                    goals = goals,
                    tasks = tasks,
                    sessions = sessions,
                    recordCounts = RecordCounts(subjects.size, goals.size, tasks.size, sessions.size),
                    sessionSummary = summary
                )
            )
            val payload = "<plan_data>\n$serialized\n</plan_data>"
            if (payload.length > MAX_LLM_PROMPT_CHARS) {
                throw LearningAnalysisRequestTooLargeException()
            }
            return payload
        }

        companion object {
            fun from(
                payload: SyncSnapshotPayload,
                context: LearnerContext,
                nowMs: Long,
                zoneId: ZoneId
            ): AnalysisInput {
                val today = Instant.ofEpochMilli(nowMs).atZone(zoneId).toLocalDate()
                val currentWeekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                fun dateOf(epochMs: Long) = Instant.ofEpochMilli(epochMs).atZone(zoneId).toLocalDate()
                fun taskScope(task: SyncTaskDto): String {
                    val taskDate = dateOf(task.dueAt ?: task.createdAt)
                    return when {
                        taskDate == today -> "today"
                        taskDate in currentWeekStart..currentWeekStart.plusDays(6) -> "current_week"
                        else -> "historical"
                    }
                }
                val activeSubjects = payload.subjects.filter { it.deletedAt == null }
                val subjects = activeSubjects.mapIndexed { index, subject ->
                    Subject(index, cleanInput(subject.name), subject.isArchived)
                }
                val subjectIndexes = activeSubjects.mapIndexed { index, subject -> subject.remoteId to index }.toMap()
                val activeTasks = payload.tasks.filter { it.deletedAt == null }
                val taskIndexes = activeTasks.mapIndexed { index, task -> task.remoteId to index }.toMap()
                val tasks = activeTasks.mapIndexed { index, task ->
                    Task(
                        taskIndex = index,
                        subjectIndex = task.subjectRemoteId?.let(subjectIndexes::get),
                        title = cleanInput(task.title),
                        content = cleanInput(task.content.orEmpty()),
                        type = task.type,
                        priority = task.priority,
                        status = task.status,
                        targetDurationSeconds = task.targetDurationSeconds,
                        due = task.dueAt,
                        completed = task.status == 1 || task.completedAt != null,
                        completedAt = task.completedAt,
                        created = task.createdAt,
                        timeScope = taskScope(task)
                    )
                }
                val goals = payload.weeklyGoals.filter { it.deletedAt == null }.mapIndexed { index, goal ->
                    Goal(
                        goalIndex = index,
                        weekStart = dateOf(goal.weekStart).toString(),
                        title = cleanInput(goal.title),
                        successCriteria = cleanInput(goal.successCriteria.orEmpty()),
                        status = goal.status,
                        completed = goal.status == 1 || goal.completedAt != null,
                        completedAt = goal.completedAt,
                        deferredToWeekStart = goal.deferredToWeekStart,
                        reason = cleanInput(goal.exceptionReason.orEmpty())
                    )
                }
                val sessions = payload.studySessions.filter {
                    it.deletedAt == null && it.endTime != null
                }.mapIndexed { index, session ->
                    val end = requireNotNull(session.endTime)
                    Session(
                        sessionIndex = index,
                        subjectIndex = session.subjectRemoteId?.let(subjectIndexes::get),
                        taskIndex = session.taskRemoteId?.let(taskIndexes::get),
                        subject = cleanInput(activeSubjects.firstOrNull { it.remoteId == session.subjectRemoteId }?.name.orEmpty()),
                        studyDate = dateOf(session.startTime).toString(),
                        title = cleanInput(session.title.orEmpty()),
                        start = session.startTime,
                        end = end,
                        durationSeconds = session.durationSeconds,
                        pauseSeconds = session.pauseSeconds,
                        focusScore = session.focusScore,
                        aiHelpSeconds = session.aiHelpSeconds,
                        aiHelpCount = session.aiHelpCount,
                        externalAiAppSeconds = session.externalAiAppSeconds,
                        aiUsageSource = session.aiUsageSource,
                        status = session.status
                    )
                }
                return AnalysisInput(
                    learnerContext = LearnerContextInput(
                        purpose = cleanInput(context.purpose),
                        examName = cleanInput(context.examName),
                        focusSubjects = context.focusSubjects.map(::cleanInput).filter(String::isNotBlank),
                        targetDate = cleanInput(context.targetDate)
                    ),
                    scope = AnalysisScope(today.toString(), currentWeekStart.toString(), zoneId.id),
                    subjects = subjects,
                    goals = goals,
                    tasks = tasks,
                    sessions = sessions,
                    taskReferences = activeTasks.map { TaskReference(it.subjectRemoteId, it.remoteId) }
                )
            }
            private fun cleanInput(value: String): String =
                value.replace(Regex("[\\u0000-\\u001f\\u007f]"), " ").trim()
        }
    }

    @Serializable private data class LearnerContextInput(
        val purpose: String,
        val examName: String,
        val focusSubjects: List<String>,
        val targetDate: String
    )
    @Serializable private data class AnalysisScope(val today: String, val currentWeekStart: String, val zoneId: String)
    @Serializable private data class Subject(val subjectIndex: Int, val name: String, val archived: Boolean)
    @Serializable private data class Goal(
        val goalIndex: Int,
        val weekStart: String,
        val title: String,
        val successCriteria: String,
        val status: Int,
        val completed: Boolean,
        val completedAt: Long?,
        val deferredToWeekStart: Long?,
        val reason: String
    )
    @Serializable private data class Task(
        val taskIndex: Int,
        val subjectIndex: Int?,
        val title: String,
        val content: String,
        val type: Int,
        val priority: Int,
        val status: Int,
        val targetDurationSeconds: Long?,
        val due: Long?,
        val completed: Boolean,
        val completedAt: Long?,
        val created: Long,
        val timeScope: String
    )
    @Serializable private data class Session(
        val sessionIndex: Int,
        val subjectIndex: Int?,
        val taskIndex: Int?,
        val subject: String,
        val studyDate: String,
        val title: String,
        val start: Long,
        val end: Long,
        val durationSeconds: Long,
        val pauseSeconds: Long,
        val focusScore: Int?,
        val aiHelpSeconds: Long,
        val aiHelpCount: Int,
        val externalAiAppSeconds: Long?,
        val aiUsageSource: String?,
        val status: Int
    )
    private data class TaskReference(val subjectRemoteId: String?, val taskRemoteId: String)
    @Serializable private data class RecordCounts(val subjects: Int, val goals: Int, val tasks: Int, val sessions: Int)
    @Serializable private data class SessionSummary(val completedCount: Int, val effectiveFocusSeconds: Long, val pauseSeconds: Long, val studyDays: Int, val subjectDistribution: Map<String, Int>)
    @Serializable private data class SanitizedInput(
        val learnerContext: LearnerContextInput,
        val scope: AnalysisScope,
        val subjects: List<Subject>,
        val goals: List<Goal>,
        val tasks: List<Task>,
        val sessions: List<Session>,
        val recordCounts: RecordCounts,
        val sessionSummary: SessionSummary
    )
    companion object {
        private val jsonForPrompt = Json { encodeDefaults = false }
        private val VERDICTS = setOf("reasonable", "needs_adjustment", "insufficient_data")
        private val QUESTION_TYPES = setOf("concept_check", "diagnostic", "reflection")
        private val TIME_EVIDENCE_TERMS = setOf("学习时间", "专注时间", "时长", "小时", "分钟", "秒", "投入", "study time", "focus time", "duration")
        private val MASTERY_TERMS = setOf("掌握", "理解", "熟练", "精通", "学会", "会做", "能力", "mastery", "mastered", "proficiency", "understand", "understood", "competence")
        private val MARKDOWN_JSON_BLOCK = Regex("""\A```json[ \t]*\r?\n([\s\S]*?)\r?\n```\z""", RegexOption.IGNORE_CASE)
        private val JSON_NUMBER = Regex("""-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?""")
        private val JSON_LITERAL_VALUES = setOf("true", "false", "null")
        private const val MAX_TEXT = 200
        private const val MAX_QUESTIONS = 10
    }
}

class LearningAnalysisRequestTooLargeException : IllegalStateException("learning analysis request too large")

internal object LlmOutputFailure {
    fun exception(category: LlmFailureCategory): LlmProviderException = LlmProviderException(
        category,
        when (category) {
            LlmFailureCategory.OUTPUT_ROOT_SHAPE -> "LLM output root shape is invalid"
            LlmFailureCategory.OUTPUT_ANSWER_GUARD -> "LLM output contains forbidden answer fields"
            LlmFailureCategory.OUTPUT_SCHEMA -> "LLM output schema is invalid"
            LlmFailureCategory.OUTPUT_CONSTRAINTS -> "LLM output constraints are invalid"
            LlmFailureCategory.OUTPUT_TASK_BINDING -> "LLM output task binding is invalid"
            LlmFailureCategory.OUTPUT_PROTOCOL -> "LLM output protocol is invalid"
            else -> "LLM output validation failed"
        }
    )
}

@Serializable private data class LlmAssessmentQuestionOutput(
    val sourceTaskIndex: Int? = null,
    val type: String,
    val prompt: String,
    val rationale: String,
    val rubric: List<String>
)

@Serializable private data class LlmAssessmentDraftOutput(
    val status: String,
    val scopeSummary: String,
    val questions: List<LlmAssessmentQuestionOutput>
)

@Serializable private data class LlmAnalysisOutput(
    val profile: SyncLearningProfileDto,
    val planEvaluation: SyncPlanEvaluationDto,
    val assessmentDraft: LlmAssessmentDraftOutput,
    val warnings: List<String> = emptyList()
)
