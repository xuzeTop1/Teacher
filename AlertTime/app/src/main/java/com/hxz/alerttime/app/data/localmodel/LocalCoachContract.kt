package com.hxz.alerttime.app.data.localmodel

import kotlinx.serialization.json.*

enum class CoachTask(val wire: String, val label: String, val prefix: String, val grammar: String) {
    Factors("extract_factors", "打卡复盘", "学习打卡记录：", "grammar_extract_factors.gbnf"),
    Create("plan_create_advice", "计划建议", "新计划：", "grammar_plan_create.gbnf"),
    Delete("plan_delete_inference", "调整原因", "被删除计划：", "grammar_plan_delete.gbnf")
}

data class CoachResult(val task: CoachTask, val summary: String, val json: String)

/** Matches the frozen v2 training schemas. Never writes plans, timer facts or mastery. */
object LocalCoachContract {
    const val MAX_INPUT_CHARS = 1200
    private val json = Json { isLenient = false; allowSpecialFloatingPointValues = false }

    fun prompt(task: CoachTask, text: String): String {
        require(text.isNotBlank() && text.length <= MAX_INPUT_CHARS)
        // User text must not introduce ChatML role boundaries.
        val clean = text.trim().replace("<|", "＜|").replace("|>", "|＞")
        return "<|im_start|>system\n你是由 TeacherAgent 驱动的端侧学习助手。根据学生输入，输出严格的结构化 JSON。<|im_end|>\n" +
            "<|im_start|>user\n【任务: ${task.wire}】\n${task.prefix}$clean<|im_end|>\n<|im_start|>assistant\n"
    }

    fun parse(task: CoachTask, raw: String): CoachResult {
        require(raw.length <= 8192)
        val obj = json.parseToJsonElement(raw) as? JsonObject ?: error("local_output_invalid")
        fun string(key: String, max: Int = 64): String {
            val value = obj[key] as? JsonPrimitive ?: error("local_output_invalid")
            require(value.isString && value.content.isNotBlank() && value.content.length <= max)
            require(value.content.none { it.isISOControl() })
            return value.content
        }
        fun number(key: String, range: ClosedFloatingPointRange<Double>): Double {
            val value = obj[key] as? JsonPrimitive ?: error("local_output_invalid")
            require(!value.isString)
            val n = value.doubleOrNull ?: error("local_output_invalid")
            require(n.isFinite() && n in range)
            return n
        }
        fun choice(key: String, choices: Map<String, String>): String =
            choices[string(key)] ?: error("local_output_invalid")
        require(string("task") == task.wire)
        val fields: Set<String>
        val summary = when (task) {
            CoachTask.Factors -> {
                fields = setOf("task", "r_focus", "n_distract", "perceived_difficulty", "confidence", "evidence")
                val focus = number("r_focus", 0.0..1.0)
                val distract = obj["n_distract"] as? JsonPrimitive ?: error("local_output_invalid")
                require(!distract.isString && distract.intOrNull?.let { it >= 0 } == true)
                val difficulty = number("perceived_difficulty", 0.0..1.0)
                val confidence = number("confidence", 0.0..1.0)
                "估计专注率 ${(focus * 100).toInt()}%，分心 ${distract.int} 次\n" +
                    "主观难度 ${(difficulty * 100).toInt()}%，模型置信度 ${(confidence * 100).toInt()}%\n" +
                    "模型依据：${string("evidence", 120)}\n这些是文本推断，不会覆盖计时记录或掌握度。"
            }
            CoachTask.Create -> {
                fields = setOf("task", "risk", "commitment", "advice")
                val risk = choice("risk", mapOf("none" to "可尝试", "overload" to "可能负荷过高", "vague" to "目标需要细化"))
                number("commitment", 0.0..1.0)
                "$risk\n${string("advice", 45)}\n日期冲突需另外核对，本模型不判断日程重叠。"
            }
            CoachTask.Delete -> {
                fields = setOf("task", "abandon_reason", "frustration_level", "suggest_action", "bkt_signal", "advice")
                val reason = choice("abandon_reason", mapOf("difficulty_avoidance" to "遇到难点", "time_conflict" to "时间安排冲突", "already_completed" to "可能已完成", "burnout" to "可能需要休息", "plan_adjustment" to "计划调整"))
                choice("frustration_level", mapOf("low" to "低", "medium" to "中", "high" to "高"))
                choice("suggest_action", mapOf("split_into_micro_steps" to "拆分", "reschedule" to "改期", "switch_subject" to "换科目", "rest" to "休息"))
                number("bkt_signal", -0.3..0.1)
                "可能原因：$reason\n${string("advice", 45)}\n原因可能判断错误，请以你的实际情况为准。"
            }
        }
        require(obj.keys == fields)
        return CoachResult(task, summary, raw)
    }
}
