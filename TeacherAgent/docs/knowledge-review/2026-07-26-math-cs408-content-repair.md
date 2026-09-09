# Draft Pack 内容修复审核记录 — 数学 + CS408 网络

日期：2026-07-26
审核者：AI 辅助独立推导（非人工专家签字）
状态：所有修复后 Pack 仍为 draft，尚未获得正式向量库准入

---

## 修复的 Pack 清单

### 1. math-derivatives（12 节点 / 9 题）

修复的 entity ID：
- math-deriv-definition: 极限定义分式结构损坏 `\frac{f(x_0))}{(x}` → 正确 `\frac{f(x_0+\Delta x)-f(x_0)}{\Delta x}`
- math-deriv-power: 内联数学分隔符损坏 `$f(x) =$ax $+ b$` → `$f(x) = ax + b$`
- math-deriv-sum-product: 分隔符损坏 + 商规则分式错误
- math-deriv-chain: `d\frac{y}{d}x` → `\frac{dy}{dx}`（×3）
- math-deriv-trig: `\frac{1}{c}os^2x` → `\frac{1}{\cos^2 x}`; `1/\\sqrt` → `1/\sqrt`
- math-deriv-implicit: `d\frac{y}{d}x` → `\frac{dy}{dx}`（×3）
- math-deriv-parametric: 多处导数记号损坏（×8）
- math-deriv-higher-order: `d^2\frac{y}{d}x^2` → `\frac{d^2y}{dx^2}`
- math-deriv-q001: `\\lim` + 分式括号损坏
- math-deriv-q003: 内联数学分隔符断裂
- math-deriv-q004: `d\frac{y}{d}x` → `\frac{dy}{dx}`
- math-deriv-q006: `\\sqrt` + `\frac{1}{1}0` → `\frac{1}{10}`
- math-deriv-q007: 多处商规则分式括号损坏

错误模式：导数 Leibniz 记号被系统性拆分为 `d\frac{y}{d}x`；双反斜杠 `\\sqrt`/`\\lim`；分式花括号错位。
来源/许可证：original_generated，无版权问题。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 2. math-indefinite-integrals（8 节点 / 8 题）

修复的 entity ID：
- math-integral-basic-formulas: 幂规则 `x^\frac{(n+1)}{(n+1)}` → `\frac{x^{n+1}}{n+1}`（**数学含义错误**：原式=x^1=x）
- math-integral-substitution: `\\cos` → `\cos`
- math-integral-substitution-reverse: `\\sqrt`×3 + `d\frac{x}{d}t` → `\frac{dx}{dt}`
- math-integral-by-parts: 分隔符断裂 `$\int u dv =$uv $- \int v du$`
- math-integral-rational: `P\frac{(x)}{Q}(x)` → `\frac{P(x)}{Q(x)}`（**数学含义错误**）
- math-integral-trig-reduction: `\frac{(1-cos2x)}{2}` → `\frac{1-\cos 2x}{2}`
- math-integral-special: `\\sqrt`×5 + `\int d\frac{x}{(x^2+a^2)}`
- math-integ-q002: **sin(x²/2) → ½sin(x²)**（不同函数！）
- math-integ-q004: **sin(2x/4) → sin(2x)/4**（不同函数！）
- math-integ-q001/q003/q005/q006/q007: 双反斜杠 + 分式括号损坏

错误模式：三角函数参数被分式改写（改变数学含义）；幂规则指数被写成分式（x^1 而非 x^(n+1)/(n+1)）。
来源/许可证：original_generated。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 3. probability-distributions（9 节点 / 10 题）

修复的 entity ID：
- prob-q001: `1\frac{0}{3}2 = \frac{5}{1}6` → `\frac{10}{32} = \frac{5}{16}`（数字被花括号拆分）
- prob-q002: `2e^\frac{(-2)}{3}` → `\frac{2e^{-2}}{3}`
- prob-q004: `Z = (X - \frac{70)}{10}` → `Z = \frac{X-70}{10}`; `\\sqrt{1}00` → `\sqrt{100}`
- prob-q010: **λ=np=5×0.2=1 → λ=np=200×0.005=1**（代入参数与题目矛盾）
- prob-geometric: `\frac{(1-p)}{p}^2` → `\frac{1-p}{p^2}`（**Var 公式错误**）
- prob-normal: `(\frac{1}{(\sigma\\sqrt{2\pi}}))` → `\frac{1}{\sigma\sqrt{2\pi}}`
- prob-expectation-variance-properties: `\frac{Cov(X,Y)}{(\sigma_X} \cdot \sigma_Y)` → `\frac{Cov(X,Y)}{\sigma_X \cdot \sigma_Y}`
- prob-central-limit-theorem: `(X̄_n - \frac{\mu)}{(\sigma/\\sqrt{n})}` → `\frac{\bar{X}_n - \mu}{\sigma/\sqrt{n}}`

错误模式：数字被花括号拆分（10→1}0, 16→1}6）；指数/下标被写成外部分式。
来源/许可证：original_generated。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 4. cs408-computer-networks（40 节点 / 40 题）

修复的 entity ID（主要）：
- cs408-cn-q-ip-001: `202.118.1.\frac{0}{2}4` → `202.118.1.0/24`（CIDR 被改写成分式）
- cs408-cn-q-cidr-001: 同上模式（×4 路由）
- cs408-cn-q-subnet-001: `172.16.6.\frac{0}{2}3` → `172.16.6.0/23`
- cs408-cn-q-cidr-agg-001: 同上（×4 + 聚合 /22）
- cs408-cn-q-physical-001: `10^(d\frac{B}{1}0)` → `10^(dB/10)`
- cs408-cn-q-window-001: 多处数字被分式拆分
- cs408-cn-q-fragment-001: 偏移量计算数字拆分
- cs408-cn-q-congestion-001/002: `cwn\frac{d}{2}` → `cwnd/2`
- cs408-cn-osi-model/tcpip-model: `TC\frac{P}{I}P` → `TCP/IP`
- cs408-cn-cidr: CIDR 记号损坏
- cs408-cn-csma-ca: `RT\frac{S}{C}TS` → `RTS/CTS`

错误模式：CIDR `/24` 被系统性改写为 `\frac{0}{2}4`；协议名中的 `/` 被改写为分式。
来源/许可证：original_generated, human_authored_with_exam_outline_reference。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 5. math-integral-applications（6 节点 / 7 题）

修复：math-intapp-arc-length 弧长公式花括号错位 + 双反斜杠；q002/q004/q005 数字拆分。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 6. math-definite-integrals（8 节点 / 7 题）

修复：math-defint-improper `\\lim` + `\\sqrt`；math-defint-convergence `f\frac{(x)}{g}(x)` + **`x^\frac{(1-p)}{(1-p)}` → `\frac{x^{1-p}}{1-p}`**（数学含义错误）；q005 `\\lim`×3。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 7. math-mean-value-theorems（5 节点 / 7 题）

修复：math-mvt-cauchy `f'\frac{(c)}{g}'(c)` → `\frac{f'(c)}{g'(c)}`；math-mvt-taylor-remainder **`(1/n)!` → `1/n!`**（数学含义错误）；q002-q007 多处 `\\lim`/`\\ln`/指数外置。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 8. math-multivariable-calculus（7 节点 / 7 题）

修复：math-multi-limit `\sqrt{(x-x_0}^2` 花括号错位；math-multi-total-diff `\\sqrt`；q004 `d\frac{z}{d}t`×6。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

### 9. math-applications-of-derivatives（7 节点 / 8 题，仅 questions 有损坏）

修复：q005 `d\frac{V}{d}t`×4；q006 `\frac{(1-x^2)}{(x^2+1)}^2` → `\frac{1-x^2}{(x^2+1)^2}`（指数外置改变含义）；q007 数字拆分。
待人工审核：尚未准入（AI 独立验证通过，仍需学科专家签字 + KaTeX 渲染验收）。

---

## 确认无损坏的 Pack（无需修复）

- probability-basics（knowledge + questions）
- linear-algebra-basics（knowledge + questions）
- linear-algebra-expanded（knowledge + questions）
- math-applications-of-derivatives knowledge

## 已批准 Pack 附带发现

- math-limits knowledge line 321：之前报告的 `x^(2/2)` 问题已不存在（当前内容正确）
- math-limits questions：仅有 cosmetic 级别 `\frac{(...)}` 多余括号，不影响数学含义

---

## 系统性错误模式总结

| 模式 | 出现次数 | 严重性 |
|------|----------|--------|
| `\\sqrt`/`\\lim`/`\\ln` 双反斜杠 | ~25 | CRITICAL（渲染为换行+文字） |
| `d\frac{y}{d}x` 导数记号拆分 | ~14 | CRITICAL（渲染为 d·(y/d)·x） |
| `\frac{(...)}{...}^n` 指数外置 | ~8 | CRITICAL（改变数学含义） |
| `f'\frac{(c)}{g}'(c)` 分式记号拆分 | ~6 | CRITICAL |
| 数字被花括号拆分 `\frac{0}{2}4` | ~15 | CRITICAL（CIDR/数字损坏） |
| 花括号错位 `(x-x_0}^2` | ~5 | CRITICAL |
| `\frac{1}{l}n`  garbled \ln | 2 | CRITICAL |
| `\frac{(e-1)}{2}` 多余括号 | ~12 | Cosmetic |

## 结论

本次修复覆盖 8 个数学 Pack + 1 个 CS408 Pack（其中 math-applications-of-derivatives 仅 questions 有损坏，knowledge 无需修复）。
所有修复均经独立数学推导验证。所有 Pack 保持 status="draft"。
正式批准需要：人工学科专家签字 + 渲染截图验收 + 向量库准入测试。
