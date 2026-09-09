package com.hxz.alerttime.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusCodesTest {

    // ---- Task status constants have expected values ----

    @Test
    fun `task status constants have expected values`() {
        assertEquals(0, StatusCodes.TASK_TODO)
        assertEquals(1, StatusCodes.TASK_DONE)
    }

    @Test
    fun `task status values are distinct`() {
        assertNotEquals(StatusCodes.TASK_TODO, StatusCodes.TASK_DONE)
    }

    // ---- Session status constants have expected values ----

    @Test
    fun `session status constants have expected values`() {
        assertEquals(0, StatusCodes.SESSION_COMPLETED)
        assertEquals(1, StatusCodes.SESSION_RUNNING)
    }

    @Test
    fun `session status values are distinct`() {
        assertNotEquals(StatusCodes.SESSION_COMPLETED, StatusCodes.SESSION_RUNNING)
    }

    // ---- Event type constants have expected values ----

    @Test
    fun `event type constants have expected values`() {
        assertEquals(1, StatusCodes.EVENT_START)
        assertEquals(2, StatusCodes.EVENT_PAUSE)
        assertEquals(3, StatusCodes.EVENT_RESUME)
        assertEquals(4, StatusCodes.EVENT_END)
        assertEquals(6, StatusCodes.EVENT_DISTRACTION)
        assertEquals(7, StatusCodes.EVENT_DISTRACTION_APP)
        assertEquals(8, StatusCodes.EVENT_AI_HELP)
    }

    @Test
    fun `event type values have no duplicates`() {
        val eventValues = listOf(
            StatusCodes.EVENT_START,
            StatusCodes.EVENT_PAUSE,
            StatusCodes.EVENT_RESUME,
            StatusCodes.EVENT_END,
            StatusCodes.EVENT_DISTRACTION,
            StatusCodes.EVENT_DISTRACTION_APP,
            StatusCodes.EVENT_AI_HELP
        )
        assertEquals(
            "Event type values should all be unique",
            eventValues.size,
            eventValues.toSet().size
        )
    }

    // ---- Task type constants ----

    @Test
    fun `task type constant has expected value`() {
        assertEquals(1, StatusCodes.TYPE_PLAN)
    }

    // ---- Default subject name ----

    @Test
    fun `default subject name is correct`() {
        assertEquals("未分类", StatusCodes.DEFAULT_SUBJECT_NAME)
    }

    @Test
    fun `default subject name is not blank`() {
        assertTrue(StatusCodes.DEFAULT_SUBJECT_NAME.isNotBlank())
    }

    // ---- All event types are positive ----

    @Test
    fun `all event type values are positive`() {
        val eventValues = listOf(
            StatusCodes.EVENT_START,
            StatusCodes.EVENT_PAUSE,
            StatusCodes.EVENT_RESUME,
            StatusCodes.EVENT_END,
            StatusCodes.EVENT_DISTRACTION,
            StatusCodes.EVENT_DISTRACTION_APP,
            StatusCodes.EVENT_AI_HELP
        )
        eventValues.forEach { value ->
            assertTrue("Event value $value should be positive", value > 0)
        }
    }
}
