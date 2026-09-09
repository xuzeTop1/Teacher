package com.hxz.alerttime.app.data.backup

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupTimerGateTest {

    @Test
    fun backupExclusive_refused_whileTimerActive() = runBlocking {
        val gate = BackupTimerGate()
        assertTrue(gate.tryStartTimer())

        val result = gate.runBackupExclusive { 42 }

        assertNull(result)
    }

    @Test
    fun backupExclusive_runs_whenTimerIdle() = runBlocking {
        val gate = BackupTimerGate()

        val result = gate.runBackupExclusive { 42 }

        assertEquals(42, result)
    }

    @Test
    fun backupExclusive_runsAgain_afterTimerIdle() = runBlocking {
        val gate = BackupTimerGate()
        assertTrue(gate.tryStartTimer())
        assertNull(gate.runBackupExclusive { 1 })

        gate.markTimerIdle()

        assertEquals(42, gate.runBackupExclusive { 42 })
    }

    @Test
    fun timerStart_refused_whileBackupRuns() = runBlocking {
        val gate = BackupTimerGate()

        val startedInside = gate.runBackupExclusive { gate.tryStartTimer() }

        // The block runs while the gate is held: the timer must not start.
        assertEquals(false, startedInside)
    }

    @Test
    fun timerStart_afterBackupFinished_succeeds() = runBlocking {
        val gate = BackupTimerGate()
        gate.runBackupExclusive { }

        assertTrue(gate.tryStartTimer())
    }

    @Test
    fun timerStart_secondStart_refused_untilIdle() {
        val gate = BackupTimerGate()
        assertTrue(gate.tryStartTimer())
        assertFalse(gate.tryStartTimer())

        gate.markTimerIdle()
        assertTrue(gate.tryStartTimer())
    }

    @Test
    fun timerBusyMarkedByRestore_blocksBackup() = runBlocking {
        val gate = BackupTimerGate()
        gate.markTimerBusy()

        assertNull(gate.runBackupExclusive { 42 })

        gate.markTimerIdle()
        assertEquals(42, gate.runBackupExclusive { 42 })
    }
}
