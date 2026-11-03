# AlertTime 本地微调模型接入

2026-10-18。使用用户指定的 `AlertTime-teacheragent-json` Android 工程。

## 运行入口

- 首页「本地学习助手 · 打卡复盘与计划建议」：输入本次学习情况，点击「本地分析」。
- 新建/编辑计划表单「用本地模型看看这个计划」：带入当前计划、所选日期的已排总时长；时长缺失时明确标记未知，允许用户补充目标。
- 删除计划确认框：可填写调整原因，点击「先听听本地助手的建议」。最终删除仍需用户点击原有确认按钮。

这三个入口只处理用户在弹窗确认的输入。它们不访问网络、不读取日记或历史会话备注，不复用云端 Provider，也不上传内容。独立云端「学习分析与模型设置」沿用原有契约，未被替换成小模型。

## 模型和运行库

权重来自 `<FINETUNE_PROJECT>\export\qwen2.5-0.5b-bkt-v2-q4_k_m.gguf`，397807424 字节。SHA-256：

`daed6c55a53da9196c8ce1f6ce5b645d731ad628d3b78946b0f564dd56e83cf8`

原始训练、导出和评测目录保持只读。未继续微调或重新量化。训练 README 中提到的 `v2-merged` 路径在此次检查时不存在，接入依据是已核验的 v2 GGUF 文件，而不是该路径的文字说明。

llama.cpp 固定为 `932a68e06845a1240227b6cb8d8c6ba38fdbef8d`，与本机已有模型验证工具版本一致。源码归档 SHA-256 为 `b21c204aee49bb35cd3498157d7cd9037cb251df9f6edef107fcbf07c91c6f58`。采用官方 [Android NDK/CMake 路线](https://github.com/ggml-org/llama.cpp/blob/932a68e06845a1240227b6cb8d8c6ba38fdbef8d/docs/android.md)。Android NDK r28c、CMake 3.22.1、仅 ARM64 CPU，基线不要求 dotprod/SVE，最大 4 个推理线程。

模型随 APK 打包且不压缩；首次分析提取到 `noBackupFilesDir/local-coach`，流式复制、核对字节数与 SHA-256 后原子改名。后续每次分析重验摘要。需要模型提取所需约 400 MB 额外空间，安装包自身也约 400 MB；设备实际可用内存和速度需实测。

## 推理边界

保留训练时的系统提示词和 ChatML 模板；转义用户输入中的角色分隔符。任务选择对应原有 GBNF grammar，输出还需经独立 Kotlin 契约校验：任务绑定、必填字段、枚举、数值范围、文本长度和额外字段。输入最多 1200 字符，超过上限直接拒绝；超过 2048 token 上下文容量也拒绝，不截断输入。输出最多 512 token；未正常结束或无效 JSON 不作为成功结果展示。

全进程串行推理，离开页面/用户取消时请求原生中止；模型加载回调、推理解码回调和逐 token 检查共用 120 秒截止时间。它是进程内协作取消，不能承诺任意原生系统阻塞都能立即中断。每次请求释放模型、上下文和 sampler，避免长期占用计时 App 内存。原生日志关闭，UI 只显示固定安全错误。

专注率、分心次数、主观难度与删除原因属于模型推断，不能冒充计时事实。`bkt_signal` 仅校验，不写入掌握度。模型不会创建、删除、改期计划或确认完成。没有新增 Room 表或同步协议字段，未修改备份 JSON 白名单。推断正文只在内存显示。

Task 2 只接受 `none/overload/vague`，不包含 `conflict`。当前计划数据只有执行日期，不能据此推断具体时段冲突；UI 明示需另外核对日程。删除原因不是用户事实或心理诊断，UI 提示可能判断错误。

## 重建

1. 运行 `scripts/prepare-local-model.ps1 -ModelSource <上述 v2 GGUF 路径>`，复制并验证权重，下载及验证固定引擎源码。模型原件不变。源码与大权重为本地忽略文件。
2. 安装 Android SDK 36、NDK `28.2.13676358` 与 CMake `3.22.1`。需要自定义 NDK 路径时传入 `-Palerttime.ndkPath=<NDK 绝对路径>`；CMake 可安装到 SDK 或将其 `bin` 加入 PATH。
3. 执行 `gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest`。`preBuild` 强制核对内嵌模型 SHA-256，未准备权重不能产生空壳模型包。

测试设备必须为 ARM64。`LocalCoachNativeTest` 使用 APK 内权重和人工合成输入，不读取 Room 数据或生产 Provider Key；它仍需用户明确授权测试设备后才能运行。不得将测试 APK 安装到保存真实学习数据的设备来代替隔离测试。

此次已连接手机的现有 `com.hxz.alerttime.app` APK 签名 SHA-256 为 `a8b30d300cba1a163babe20435845955ac514942be55e98d4f969520bd9333b3`，本机调试证书为 `923404246fa81599f55c7d362cf08ebd5aec55d6d218c94e6b0a2cd757ea957e`。签名不同，不能保留数据覆盖安装。为完成独立验证，使用 `-Palerttime.isolatedModelTest=true` 构建并存测试版，包名 `com.hxz.alerttime.app.localcoach`、名称「Alert 本地模型测试」。它拥有独立数据库和 Keystore 命名空间，不导入原 APP 的记录。

默认正式工程仍使用原 `com.hxz.alerttime.app` 包名。更新现有安装必须使用匹配原证书的签名构建；不得通过卸载原 APP 或清数据绕过签名差异。此次不移动、替换或导出用户的学习数据库。

## 验收记录

此次自动化结果：39 个套件 / 318 项 JVM 测试通过；`lintDebug` 0 错误 / 15 警告（本地模型新增文件无报告项）；Debug APK、androidTest APK、并存测试版及 R8 压缩 Release APK 均构建通过。压缩映射确认 `QwenNative` 类名保留；APK 中模型摘要匹配、权重不压缩、ARM64 原生库与许可证齐全，16 KiB ZIP/ELF 对齐检查通过。电脑端三个合成任务均生成对应任务的结构化 JSON，此检查不评价预测是否正确，也不替代手机验证。

用户明确授权后，已通过 `adb install -r` 成功安装并存测试版和专用测试包。设备 ARM64 / API 37。最终三任务 instrumentation 完整通过，输出 `OK (1 test)`，总耗时 20.706 秒；手机保存的回执 `completed=true`，三项都为 `validated=true`：打卡因子提取 12738 ms、创建计划建议 3069 ms、删除原因分析 4238 ms。这是三个合成样例的端侧调用和结构校验通过，不是任务正确率评估或性能基准。

此前因 USB 断连和自动 Activity 启动阻塞而中断的记录保留；电脑端 ADB 服务重启后完成最终测试。测试改为直接调用模型，仅在隔离包中临时持有有时限的亮屏锁，并在 `finally` 中释放，不修改全局锁屏设置。原 `com.hxz.alerttime.app` 未覆盖、未卸载、未清数据，未导出其学习数据库。

交付安装包与可核验回执位于 `<REPO_ROOT>\.codex-task-artifacts\alerttime-qwen\delivery`，其中 `AlertTime-Qwen-v2-isolated-test.apk` 是已安装的并存版本，`delivery-receipt.json` 记录模型/安装包摘要及当前边界。Release 产物尚未使用原 APP 的证书签名。

已实际打开并存版首页，确认本地助手入口可见。仍不宣称完整页面交互、取消耗时、内存/耗电基准或任务正确率已验收。历史模型评测分数不能替代本次集成验证。

## 第三方声明

APK 的 `assets/local-coach/` 包含 Qwen 基座模型 Apache 2.0 许可证、llama.cpp MIT 许可证及来源说明。Qwen 基座许可证见[官方模型仓库](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE)。本地微调权重是用户提供的衍生产物；本次只做用户本地 APK 集成，不发布模型或安装包。
