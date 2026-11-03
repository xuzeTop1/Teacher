package com.hxz.alerttime.app.ui.assessment

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LearningAnalysisDialogTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun localGenerationIsAvailableWithoutTeacherPairingOrProvider() {
        var generated = false
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = LearningAnalysisUiState(loading = false),
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = { },
                    onDisableProvider = {},
                    onGenerate = { generated = true },
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithText("学习分析与模型设置").assertIsDisplayed()
        composeRule.onNodeWithText("无需连接 TeacherAgent", substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("先配对", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("应用不内置默认 Provider", substring = true)
            .performScrollTo()
            .assertIsDisplayed()
        composeRule.onNodeWithText("在手机生成学习分析")
            .performScrollTo()
            .assertIsEnabled()
            .performClick()

        composeRule.runOnIdle { assertTrue(generated) }
    }

    @Test
    fun providerFieldsSubmitBaseUrlModelAuthAndKeyWithoutPositionSwap() {
        var submitted: LlmProviderForm? = null
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = LearningAnalysisUiState(loading = false),
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = { submitted = it },
                    onDisableProvider = {},
                    onGenerate = {},
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithTag("learning-analysis-provider-base-url")
            .performTextInput("https://api.moonshot.cn/v1")
        composeRule.onNodeWithTag("learning-analysis-provider-model")
            .performTextInput("moonshot-v1-8k")
        composeRule.onNodeWithTag("learning-analysis-provider-api-key")
            .performTextInput("secret-value")
        composeRule.onNodeWithTag("learning-analysis-provider-save").performScrollTo().performClick()

        composeRule.runOnIdle {
            assertEquals(
                LlmProviderForm(
                    baseUrl = "https://api.moonshot.cn/v1",
                    model = "moonshot-v1-8k",
                    authMode = "bearer",
                    apiKey = "secret-value"
                ),
                submitted
            )
        }
    }

    @Test
    fun successfulProviderSaveClearsDirtyDraftAndApiKeyInput() {
        var uiState by mutableStateOf(LearningAnalysisUiState(loading = false))
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = uiState,
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = { form ->
                        uiState = uiState.copy(
                            provider = uiState.provider.copy(
                                enabled = true,
                                baseUrl = form.baseUrl,
                                model = form.model,
                                authMode = form.authMode,
                                hasStoredApiKey = true,
                                apiKeyClearVersion = uiState.provider.apiKeyClearVersion + 1
                            ),
                            errorMessage = null
                        )
                    },
                    onDisableProvider = {},
                    onGenerate = {},
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithTag("learning-analysis-provider-base-url")
            .performTextInput("https://api.moonshot.cn/v1")
        composeRule.onNodeWithTag("learning-analysis-provider-model")
            .performTextInput("moonshot-v1-8k")
        composeRule.onNodeWithTag("learning-analysis-provider-api-key")
            .performTextInput("secret-value")
        composeRule.onNodeWithTag("learning-analysis-provider-save").performScrollTo().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithText("设置有未保存修改", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("secret-value", substring = true).assertDoesNotExist()
    }

    @Test
    fun failedProviderSaveKeepsDraftAndShowsSafeError() {
        var uiState by mutableStateOf(LearningAnalysisUiState(loading = false))
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = uiState,
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = {
                        // 与 ViewModel 的失败分支保持一致：报错 + 递增清空信号。
                        // 保存未成功即撤下明文密钥（本项目不对模型服务发密钥做校验）。
                        uiState = uiState.copy(
                            errorMessage = "模型设置保存失败，请检查地址、模型和认证方式",
                            provider = uiState.provider.copy(
                                apiKeyClearVersion = uiState.provider.apiKeyClearVersion + 1
                            )
                        )
                    },
                    onDisableProvider = {},
                    onGenerate = {},
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithTag("learning-analysis-provider-base-url")
            .performTextInput("https://api.moonshot.cn/v1")
        composeRule.onNodeWithTag("learning-analysis-provider-model")
            .performTextInput("moonshot-v1-8k")
        composeRule.onNodeWithTag("learning-analysis-provider-api-key")
            .performTextInput("secret-value")
        composeRule.onNodeWithTag("learning-analysis-provider-save").performScrollTo().performClick()
        composeRule.waitForIdle()

        // 软键盘会把对话框窗口顶偏（实测窗口相对组合根偏移约 981px），
        // 使 inWindow 变负、assertIsDisplayed() 恒判不可见。断言前先收起输入法。
        Espresso.closeSoftKeyboard()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("learning-analysis-provider-base-url")
            .assertTextContains("https://api.moonshot.cn/v1")
        composeRule.onNodeWithTag("learning-analysis-provider-model")
            .assertTextContains("moonshot-v1-8k")
        composeRule.onNodeWithText("设置有未保存修改", substring = true).performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("模型设置保存失败", substring = true)
            .performScrollTo()
            .assertIsDisplayed()
            .assertTextEquals("模型设置保存失败，请检查地址、模型和认证方式")

        // 保存失败后明文密钥必须被撤下：本项目不对模型服务发送密钥做校验，
        // 因此拿不到"密钥是否有效"的结论，凡保存未成功即清空密钥输入框
        // （与论文"密钥类秘密不外发、不落明文"的原则一致）。
        // 注意 baseUrl / model 的草稿仍然保留（见上一条断言），只有密钥被清空。
        composeRule.onNodeWithTag("learning-analysis-provider-api-key")
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.EditableText,
                    AnnotatedString("")
                )
            )
        composeRule.onNodeWithText("secret-value", substring = true).assertDoesNotExist()
    }

    @Test
    fun invalidProviderDraftShowsErrorNearSaveAndDoesNotInvokeCallback() {
        var saveCalls = 0
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = LearningAnalysisUiState(loading = false),
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = { saveCalls++ },
                    onDisableProvider = {},
                    onGenerate = {},
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithTag("learning-analysis-provider-model")
            .performTextInput("https://api.moonshot.cn/v1")
        composeRule.onNodeWithTag("learning-analysis-provider-api-key")
            .performTextInput("secret-value")
        composeRule.onNodeWithTag("learning-analysis-provider-save").performScrollTo().performClick()

        composeRule.onNodeWithTag("learning-analysis-provider-error")
            .performScrollTo()
            .assertTextEquals("模型名称不能填写服务地址，请填写服务商提供的模型 ID")
        composeRule.runOnIdle { assertEquals(0, saveCalls) }

        composeRule.onNodeWithTag("learning-analysis-provider-base-url")
            .performScrollTo()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.EditableText,
                    AnnotatedString("")
                )
            )
    }

    @Test
    fun asyncProviderSaveFailureShowsErrorNearSaveArea() {
        var uiState by mutableStateOf(LearningAnalysisUiState(loading = false))
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = uiState,
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = {
                        uiState = uiState.copy(
                            providerErrorMessage = "模型服务地址格式无效或配置不完整"
                        )
                    },
                    onDisableProvider = {},
                    onGenerate = {},
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithTag("learning-analysis-provider-base-url")
            .performTextInput("https://api.moonshot.cn/v1")
        composeRule.onNodeWithTag("learning-analysis-provider-model")
            .performTextInput("moonshot-v1-8k")
        composeRule.onNodeWithTag("learning-analysis-provider-api-key")
            .performTextInput("secret-value")
        composeRule.onNodeWithTag("learning-analysis-provider-save").performScrollTo().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("learning-analysis-provider-error")
            .performScrollTo()
            .assertTextEquals("模型服务地址格式无效或配置不完整")
    }

    @Test
    fun refreshedLegacyProviderShowsModelErrorInProviderArea() {
        composeRule.setContent {
            MaterialTheme {
                LearningAnalysisDialog(
                    state = LearningAnalysisUiState(
                        loading = false,
                        provider = LlmProviderConfigUiState(
                            enabled = false,
                            baseUrl = "https://api.moonshot.cn/v1",
                            model = "https://api.moonshot.cn/v1",
                            authMode = "bearer",
                            hasStoredApiKey = true
                        ),
                        providerErrorMessage = "模型名称不能填写服务地址，请填写服务商提供的模型 ID"
                    ),
                    onSaveContext = { _, _, _, _ -> },
                    onSaveProvider = {},
                    onDisableProvider = {},
                    onGenerate = {},
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithTag("learning-analysis-provider-error")
            .performScrollTo()
            .assertTextEquals("模型名称不能填写服务地址，请填写服务商提供的模型 ID")
    }
}
