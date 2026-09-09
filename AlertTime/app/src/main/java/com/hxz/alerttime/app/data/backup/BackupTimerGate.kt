package com.hxz.alerttime.app.data.backup

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The single coordination point shared by the focus timer and backup/restore.
 *
 * Mutual-exclusion contract (both sides use THIS object, not UI state):
 * - While a focus session is active ([timerBusy] == true), every backup operation
 *   is refused at its entry.
 * - While a backup operation is running (it holds the gate), the timer cannot
 *   start a new session: [tryStartTimer] fails immediately, so no old timer state
 *   can be written while a restore replaces the database.
 *
 * The flag transitions and the backup critical section are serialized by one
 * [Mutex]; the flag itself is an [AtomicBoolean] so the non-suspend timer paths
 * ([tryStartTimer], [markTimerIdle]) never block. [tryStartTimer] uses a non-blocking
 * [Mutex.tryLock], so a timer start during a backup is refused, never queued.
 */
class BackupTimerGate {

    private val mutex = Mutex()
    private val timerBusy = AtomicBoolean(false)

    /**
     * Timer side (non-suspend, called from [TimerManager.start]): claims the
     * "session active" state. Returns false — and the session must not start —
     * while a backup operation is in progress.
     */
    fun tryStartTimer(): Boolean {
        if (!mutex.tryLock()) return false
        return try {
            timerBusy.compareAndSet(false, true)
        } finally {
            mutex.unlock()
        }
    }

    /**
     * Timer side (suspend, called from [TimerManager.restoreFromSession] when the
     * app restores a running session at startup).
     */
    suspend fun markTimerBusy() {
        mutex.withLock { timerBusy.set(true) }
    }

    /** Timer side (non-suspend): the session ended; backups may run again. */
    fun markTimerIdle() {
        timerBusy.set(false)
    }

    /**
     * Backup side: runs [block] while holding the gate. Returns null when the
     * timer is active — the caller must refuse the operation. The timer cannot
     * start while [block] runs.
     */
    suspend fun <T> runBackupExclusive(block: suspend () -> T): T? {
        return mutex.withLock {
            if (timerBusy.get()) {
                null
            } else {
                block()
            }
        }
    }
}
