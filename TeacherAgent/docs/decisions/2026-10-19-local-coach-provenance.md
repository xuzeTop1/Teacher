# 本地模型来源、推断层与规则修订 A1

> 历史方案记录。2026-10-19 的 Implementation B 已将其标为 superseded；当前字段契约与默认分支以 `docs/decisions/2026-10-19-local-coach-provenance-b1.md` 和 `sync/protocol/protocol.md` 为准。A1 中的 `profile.inferences[].localResult`、`insufficient_data` 等约定不属于当前实现。

状态：2026-10-19 用户授权实施；尚未冻结实验或注册 OSF。

- 固定新 release 签名身份，不再等待旧私钥。原手机安装不卸载、不清数据。
- 本地推断进入现有 `learningAnalysis.profile.inferences[]`，通过可选 `localResult` 携带结构化结果及来源。事实层、focusAggregates、mastery 和答题证据不接收它。整体 learningAnalysis.generator 仍描述原有分析生成器；每条本地推断有自己的 generator/failureCode，二者不混用。
- 本地 `localResult` 为严格字段白名单：固定版本、任务、时间、模型摘要、规则版本、来源、稳定失败码和受限数值/枚举。正文、advice、evidence、用户输入、日记不进入此对象。手动输入未绑定业务实体，因此 evidenceRefs 为空且 statement 使用固定任务标签，不伪造快照引用。
- 模型失败、缺失、校验失败、可捕获 OOM/低内存使用 deterministic_fallback；未知观测值为 null，confidence 为 0，删除原因 unknown、行动 review_manually。不能把默认值写成事实。协程取消继续传播。系统直接杀进程和原生致命崩溃不承诺能在进程内回退。
- 每任务只缓存最近一条结构化记录，24 小时失效，最多三条，位于 noBackupFilesDir；重启可读取，损坏/超限/未来时间/未知字段丢弃。缓存只由显式点击本地分析产生，不启动后台推理。同步复用手动同步流程，不扩大网络入口；云端提示词不包含这些本地记录。
- 创建风险规则版本 `plan-risk-a1`：已排时长已知且 >=10.5 小时优先 overload；否则必须同时具备具体动作和范围/量化锚点才可为 none；缺时长或矛盾时长为 insufficient_data，其他为 vague。规则只解析计划正文和独立的时长行，不从考试目标中借锚点。模型的 risk/commitment 不决定产品分类；对非 none 状态使用固定纠偏提示，不展示可能矛盾的鼓励文字。none 文案只说明满足具体性条件，不保证计划合理。10.5 是项目操作阈值，不是健康保证。
- 旧训练数据、120 条候选输入、原评测保留不改。规则质量、模型建议质量与资源合规分别报告；不把工程回归和三样例试跑当实验数据。
- 双端 DTO、JSON Schema、黄金样例和隐私负向用例同步更新；桌面缓存重载和 UI 投影都重新校验 localResult。

新证书指纹与最终 APK/源码身份写入构建回执。口令不进入源码或日志；Windows DPAPI 保存只解决当前账户的本地保护，不等于密码管理器保存或两份离线备份。三项实现和双端验证完成前不标记 frozen，正式实验在 OSF 注册后另行执行。
