package com.hxz.alerttime.app.ui.localcoach

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.data.localmodel.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LocalCoachState(val busy: Boolean = false, val result: CoachResult? = null, val error: String? = null)

class LocalCoachViewModel(application: Application) : AndroidViewModel(application) {
    private val engine = LocalCoachEngine(application)
    private val mutableState = MutableStateFlow(LocalCoachState())
    val state = mutableState.asStateFlow()
    private var requestId = 0L
    private var job: Job? = null

    fun analyze(task: CoachTask, text: String) {
        if (mutableState.value.busy) return
        requestId = LocalCoachEngine.nextRequestId()
        val id = requestId
        mutableState.value = LocalCoachState(busy = true)
        job = viewModelScope.launch {
            try {
                val result = engine.analyze(task, text, id)
                mutableState.value = LocalCoachState(result = result)
            } catch (e: CancellationException) {
                mutableState.value = LocalCoachState()
                throw e
            } catch (_: Exception) {
                mutableState.value = LocalCoachState(error = "本地分析未完成。请检查可用空间、输入长度，稍后重试。")
            } catch (_: LinkageError) {
                mutableState.value = LocalCoachState(error = "当前设备不支持本地模型，请使用 64 位 ARM 设备及包含模型的安装包。")
            } finally {
                if (requestId == id) requestId = 0L
            }
        }
    }

    fun clearResult() {
        if (!mutableState.value.busy) mutableState.value = LocalCoachState()
    }

    fun cancel() {
        engine.cancel(requestId)
        job?.cancel()
        // Keep busy until the native call unwinds and releases its resources.
    }

    override fun onCleared() {
        engine.cancel(requestId)
        super.onCleared()
    }
}
