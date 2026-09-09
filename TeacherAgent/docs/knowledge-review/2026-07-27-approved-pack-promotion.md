# 2026-07-27 已审核 Pack 正式准入记录

审核人：项目负责人授权的 Codex 内容审核代理

范围：此前完成逐 Pack 内容修复与 KaTeX 渲染门禁验收的 9 个 Pack。

## 结论

下列 Pack 通过本项目的 owner-delegated 内容审核，状态由 `draft` 升为
`approved`。批准依据是逐 Pack 的内容复核、题目与节点关联检查、来源字段检查、
严格 KaTeX 渲染门禁和裸 TeX 门禁；这不是外部独立学科专家认证。

| Pack | 学科 | 节点 | 题目 |
|---|---|---:|---:|
| `math-derivatives` | math | 12 | 9 |
| `math-applications-of-derivatives` | math | 7 | 8 |
| `math-indefinite-integrals` | math | 8 | 8 |
| `math-definite-integrals` | math | 8 | 7 |
| `math-integral-applications` | math | 6 | 7 |
| `math-mean-value-theorems` | math | 5 | 7 |
| `math-multivariable-calculus` | math | 7 | 7 |
| `probability-distributions` | math | 9 | 10 |
| `cs408-computer-networks` | cs408 | 40 | 40 |

本次新增正式内容为 102 个节点和 103 道题。正式目录现为 11 Pack / 145 节点 /
123 题；其余 40 Pack / 631 节点 / 643 题继续保持 `draft`。

## 准入核验

- knowledge 与 question seed 的 `status` 与 `PACK_MANIFEST` 一致。
- 9 个 Pack 的题目关联均指向本 Pack 内存在的知识节点。
- 全部实体具备 `sourceType` 与 `license` 来源字段。
- `katexRenderGate` 对用户可见字段及其嵌套提示文本执行严格渲染和裸 TeX 检测。
- Rust `ApprovedManifestRegistry` 从嵌入的 11 个 approved knowledge seed 派生，
  `sync_approved_manifest` 只会同步该集合；不接受调用方提供的内容。

## 后续验收

本记录只完成内容与运行时准入。向量准入仍须在真实 Tauri 桌面环境中，以当前
approved 集合生成 268 条向量，并确认数学和 CS408 查询显示正确的向量命中来源。
