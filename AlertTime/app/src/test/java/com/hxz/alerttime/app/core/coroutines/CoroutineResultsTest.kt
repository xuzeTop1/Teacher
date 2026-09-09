package com.hxz.alerttime.app.core.coroutines

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoroutineResultsTest {
    @Test(expected = CancellationException::class)
    fun runSuspendCatching_rethrowsCancellation() {
        runBlocking {
            runSuspendCatching<Unit> { throw CancellationException("cancelled") }
        }
    }

    @Test
    fun runSuspendCatching_wrapsOrdinaryFailure() = runBlocking {
        val result = runSuspendCatching<Unit> { error("failed") }

        assertTrue(result.isFailure)
        assertEquals("failed", result.exceptionOrNull()?.message)
    }
}
