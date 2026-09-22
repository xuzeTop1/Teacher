# 2026-09-19 补录：probability-basics 晋升依据与 catalog 可复现性审计

**审查日期**：2026-09-19
**审查性质**：负责人授权的代理内容审核（非外部独立学科专家认证）
**触发原因**：比对本地工作树与已发布快照时发现 catalog 无法从版本库重建
**关联治理条款**：`docs/knowledge-base-governance.md` §11.2 规则 5、新增 §11.3 审核授权契约

---

## 1. 发现的问题

对 52 个 seed pack 逐包比对三处状态（工作树 / 本地 HEAD / `public/main`）后：

| 位置 | approved Pack | 知识节点 | 题目 |
|------|---:|---:|---:|
| 工作树（未提交） | 51 | 773 | 764 |
| 本地 HEAD | 11 | 145 | 123 |
| `public/main`（commit `8bb63342`） | 11 | 145 | 123 |

即论文与 `knowledge-base-governance.md` §11.2 所报的 51/773/764 **不存在于任何提交中**。
原因不是数据错误，而是 2026-09-11 那批晋升只落在工作树，且两份晋升记录本身是未跟踪文件：

- `docs/knowledge-review/2026-09-11-approved-pack-promotion.md`
- `docs/knowledge-review/2026-09-11-civil-common-sense-scope-promotion.md`

40 个状态漂移的 pack 中，39 个被 09-11 主记录 §3 点名晋升，`civil-common-sense-scope`
由范围包记录覆盖，**剩 1 个没有任何晋升依据**：`probability-basics`。

## 2. `probability-basics` 的事实链

| 证据 | 位置 | 内容 |
|------|------|------|
| 规模 | `data/knowledge/probability-basics.seed.json` | 8 知识节点 / 5 题目 |
| 唯一逐包决策 | `2026-07-26-draft-pack-correction.md:41` | `\| probability-basics \| 8/5 \| FAIL \| 尚无逐题独立推导和人工复核记录 \|` |
| 修复后结论 | `2026-07-26-math-cs408-content-repair.md:142` | "所有 Pack 保持 status=\"draft\"" |
| 晋升记录 | 三份 promotion 记录全文检索 | **均未点名该包** |
| 当前状态 | 工作树 `approved` / HEAD `draft` | 变更未提交 |

结论：该包的 `approved` 是一次**遗漏文书**，不是被排除——同期被判 FAIL 的
`linear-algebra-basics` 等包都出现在 09-11 §3 的 39 个晋升名单里，唯独它没有。

## 3. 2026-09-19 复验

按 09-11 记录 §6 使用的同一套门禁重跑（Windows / Node / vitest）：

```
npx vitest run src/services/knowledge/katexRenderGate.test.ts \
               src/services/knowledge/packValidator.test.ts

katexRenderGate.test.ts   219 tests passed
packValidator.test.ts      36 tests passed
Test Files  2 passed (2)        Tests  255 passed (255)
```

`katexRenderGate.test.ts:80,150` 的枚举范围是**全部 51 个 approved pack / 102 个 seed 文件**
（仅排除 draft 的 `civil-common-sense`），因此 `probability-basics` 的 2 个 seed 文件确实在被检范围内并通过。

## 4. 决定

**保留 `approved`，晋升依据改记为本文件，日期 2026-09-19。** catalog 维持 51 / 773 / 764 不变。

理由：它满足与其余 38 个包完全相同的、且已被文档化的晋升标准（KaTeX 严格渲染 + 包完整性校验 +
来源标注齐备）。把它回退成 draft 会改变论文 catalog 却没有任何质量依据支持——那属于用行政动作
掩盖文书遗漏。

## 5. 未清除的阻塞项（必须如实保留）

07-26 记录的 FAIL 理由是"尚无逐题独立推导和人工复核记录"。**本轮复验不能清除它**：
`katexRenderGate` 与 `packValidator` 检验的是可渲染性与结构完整性，不涉及概率论事实正确性。

因此按 §11.3 两级状态语义处理：

- 包级 `status: approved` —— 认证第 3 节的门禁通过，可进入默认 Seed / Embedding / 检索。
- 条目级 `reviewStatus` 与 `source.note` —— **保持原样不改**，其中"待人工复核"的表述至今仍然准确。
- 对外表述不得出现"经学科专家审核""内容准确性已复核"。

## 6. 同类文档缺口（非状态缺陷，另行处理）

`math-limits`、`python-basics` 同样不在三份晋升记录中，但二者在本地 HEAD 与 `public/main`
都早已是 `approved`，属 2026-07-27 基线之前的存量，不是本批遗漏。它们缺的是**历史依据的回溯**，
不影响 catalog 一致性；若要补齐，应单独写一份"早期基线来源说明"，不得伪造晋升日期。

## 7. 本轮实际变更

1. `docs/knowledge-base-governance.md` 新增 §11.3 审核授权契约（两级状态轴、代理审核可/不可认证清单、对外表述限制、晋升记录必须入库）。
2. 本文件补入 `docs/knowledge-review/`，使 51/773/764 的依据首次进入版本库。
3. 提交 seed 状态与 `PACK_MANIFEST`（二者必须同批，否则违反 §11.2 规则 5）。
4. 未改动任何 `data/**` 内容：本轮不含条目级字段批量改写。
