# AlertTime local inference provenance B1

状态：实现批次 B 的代码决策记录；实验协议仍未冻结。

## 数据契约

本地结构化结果进入可选的 `learningAnalysis.inferences` 区块。记录严格扁平，按 `sync/protocol/protocol.md` 的公共字段和单任务字段白名单校验。它与 `learningAnalysis.profile.facts` 分开。原始 evidence/advice 不进同步快照或应用日志/崩溃报告；仅 debug 批测的原始输出写入设备私有测量 JSONL。

Task 1 的默认值是专注率 1.0、分心数 0，其他量值为空。Task 2 规则输出风险，模型只提供经 schema 校验的建议；规则判 vague 时固定提示优先。Task 3 失败不保存推断，不更新 BKT。

Task 2 的 `overload` 保留 `>=10.5 h/day` 既有阈值（EVAL_CARD 2.4；离线标签生成器 `data/generate_offline_data.py:382`）。具体性条件为具体动作 AND 范围锚点；范围锚点定义为 `QUANT_RE OR ARTIFACT_RE`，正则从生成器原样提取。没有显式时长只判断具体性；无效/冲突时长保守判 vague。

## 同步兼容与处理边界

协议主版本不变，使用 `localInferencesV1` 能力位。旧端缺少新块时仍可处理既有快照。桌面端缓存与展示；本轮没有修改 FB-BKT、自动检索或建议执行逻辑。没有数据库迁移。

## 结果限制

Rule/gt 一致性只作规则诊断；源 gt 的 `conflict` 第四类不在三分类器范围。120 条输入是历史诊断数据，只能测资源、合规和降级，不得作为模型准确率主结果。设备端 120 条尚未运行，研究实验尚未冻结或执行。
