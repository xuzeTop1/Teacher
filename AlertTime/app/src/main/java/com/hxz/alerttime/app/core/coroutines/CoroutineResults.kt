package com.hxz.alerttime.app.core.coroutines

import kotlinx.coroutines.CancellationException

suspend inline fun <T> runSuspendCatching(
    block: suspend () -> T
): Result<T> {
    return try {
        Result.success(block())
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (throwable: Throwable) {
        Result.failure(throwable)
    }
}
