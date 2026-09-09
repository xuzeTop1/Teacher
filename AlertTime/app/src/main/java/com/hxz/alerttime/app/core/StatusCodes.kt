package com.hxz.alerttime.app.core

/**
 * Centralized status constants shared across repositories and DAOs.
 * Avoids magic numbers scattered in business logic.
 */
object StatusCodes {
    // ---- Task status ----
    const val TASK_TODO = 0
    const val TASK_DONE = 1

    // ---- Weekly goal status ----
    const val WEEKLY_GOAL_TODO = 0
    const val WEEKLY_GOAL_DONE = 1
    const val WEEKLY_GOAL_DEFERRED = 2
    const val WEEKLY_GOAL_CANCELED = 3

    // ---- Study session status ----
    const val SESSION_COMPLETED = 0
    const val SESSION_RUNNING = 1

    // ---- Study session event types ----
    const val EVENT_START = 1
    const val EVENT_PAUSE = 2
    const val EVENT_RESUME = 3
    const val EVENT_END = 4
    const val EVENT_DISTRACTION = 6
    const val EVENT_DISTRACTION_APP = 7
    /**
     * AI 求助时段开始（显式开始语义）。
     * 兼容旧数据：旧版本只写入 EVENT_AI_HELP（=8），语义即「开始」；
     * 结束由 EVENT_AI_HELP_ENDED（=9）显式记录，旧数据缺失结束时按
     * 会话结束 / updatedAt 安全截断，不再依赖模糊的 PAUSE/RESUME 推断。
     */
    const val EVENT_AI_HELP = 8
    const val EVENT_AI_HELP_ENDED = 9

    // ---- Task type ----
    const val TYPE_PLAN = 1

    // ---- Default subject name (protected from deletion) ----
    const val DEFAULT_SUBJECT_NAME = "未分类"
}
