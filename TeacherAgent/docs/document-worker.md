# Document Worker — 本地文档解析与数学计算

## 概述

Document Worker 是 TeacherAgent 的 Python sidecar，用于本地解析 PDF/DOCX/XLSX 文档和执行 SymPy 数学计算。

## 架构

```
Tauri/Rust → std::process::Command → document-worker.exe (生产) 或 python -m document_worker (开发) → JSON stdout
```

- Python worker 是独立进程，不嵌入 Tauri 主进程
- Rust 通过固定参数调用，读取 JSON 输出；子进程环境先 `env_clear()`，只恢复 SystemRoot、临时目录和 Python UTF-8 运行所需变量
- 不执行宏/脚本，不访问网络
- 文件选择使用 `rfd`（Rust File Dialog）打开原生对话框；前端只获得一次性授权令牌，Rust 复核后将文件复制到 staging，worker 只解析副本
- **生产版**：已完成。用户无需安装 Python，worker 通过 PyInstaller 打包为 `document-worker.exe` sidecar，随 Tauri 安装包分发
- **开发版**：开发者本地安装 Python，使用 `python -m document_worker`

## 安全边界

| 约束 | 值 |
|------|-----|
| 文件大小限制 | 50MB（预览解析上限，不代表完整私有库入库上限） |
| 命令超时 | 30 秒 |
| 网络访问 | 禁止 |
| 宏执行 | 禁止 |
| 输出级别 | draft（不自动写入内置 Pack） |
| 子进程环境 | 显式白名单；不继承 PATH、Provider Key、代理、云、SSH、数据库或自定义秘密 |
| 数学表达式 | 最长 2000 字符、最多 512 token、括号深度最多 32，只允许受控运算符、变量、函数和常量 |
| 数学变量 | 1-32 位 ASCII 字母数字标识符，以字母开头 |
| 数学操作 | 仅 simplify/expand/factor/diff/integrate/solve/eval/limit |

## 支持格式

| 格式 | 解析库 | 说明 |
|------|--------|------|
| PDF | PyMuPDF (fitz) + pdfplumber + pypdf fallback | 提取文本，扫描件无法提取；预览只解析前 20 页 |
| DOCX | python-docx | 提取段落和表格文本 |
| XLSX | openpyxl | 提取单元格数据，不执行公式 |

## CLI 用法

```powershell
# 文档解析
python -m document_worker parse --file <path>

# 数学计算
python -m document_worker math --expr "<expression>" [--op <operation>] [--var <variable>]
```

### 数学操作

| 操作 | 说明 | 示例 |
|------|------|------|
| eval | 评估表达式 | `--expr "x**2 + 1" --op eval` |
| simplify | 化简 | `--expr "x**2 + 2*x + 1" --op simplify` |
| expand | 展开 | `--expr "(x+1)**2" --op expand` |
| factor | 因式分解 | `--expr "x**2 + 4*x + 4" --op factor` |
| diff | 求导 | `--expr "x**3" --op diff` |
| integrate | 积分 | `--expr "2*x" --op integrate` |
| solve | 解方程 | `--expr "x**2 - 4" --op solve` |

## JSON 输出 Schema

### parse 输出
```json
{
  "ok": true,
  "fileType": "pdf|docx|xlsx",
  "title": "文档标题",
  "pagesOrSheets": [{"name": "Page 1", "text": "..."}],
  "plainText": "全文纯文本",
  "warnings": []
}
```

### math 输出
```json
{
  "ok": true,
  "input": "x**2 + 2*x + 1",
  "result": "(x + 1)**2",
  "latex": "(x + 1)^{2}",
  "steps": ["输入表达式: x**2 + 2*x + 1", "因式分解结果: (x + 1)**2"],
  "warnings": []
}
```

## 安装依赖

```powershell
cd tools/document-worker
python -m pip install -e ".[dev]"
```

## 运行测试

```powershell
cd tools/document-worker
python -m pytest tests/ -v
```

## Worker 路径定位

Rust 端当前通过以下优先级定位 worker：

| 优先级 | 场景 | 查找方式 |
|--------|------|---------|
| 1 | 生产期 | 当前可执行文件同目录，先找 `document-worker-x86_64-pc-windows-msvc.exe`，再找 `document-worker.exe`（Tauri sidecar 打包后的位置） |
| 2 | 开发期（手动放置 exe） | `src-tauri/binaries/` 下同上优先级：triple 后缀名优先，短名次之 |
| 3 | 开发期（Python） | 环境变量 `TEACHER_AGENT_DOCUMENT_WORKER_DIR` 指向的目录，使用 `python -m document_worker` |
| 4 | 开发期默认（Python） | 项目根目录 `tools/document-worker`，使用 `python -m document_worker` |

注：0 字节的 placeholder 文件会被 `is_valid_sidecar()` 拒绝，不会被当作有效 sidecar。

### 生产版（用户安装包）

- 运行 `tools/document-worker/build.ps1` 用 PyInstaller 打包为 `document-worker.exe`
- 运行 `tools/document-worker/copy-sidecar.ps1` 将 exe 复制到 `src-tauri/binaries/document-worker-x86_64-pc-windows-msvc.exe`
- Tauri 打包时自动将 exe 放入安装包（通过 `externalBin` 配置）
- Rust 优先查找 sidecar exe，找到则直接调用，无需 Python 环境
- 用户无需安装 Python 或任何依赖

### 开发版（开发者本地）

- 开发者需安装 Python 3.10+
- 运行 `cd tools/document-worker && python -m pip install -e ".[dev]"`
- Rust 调用 `python -m document_worker parse --file <path>`
- 自动设置 `current_dir` 和 `PYTHONPATH` 为 worker 目录

### Tauri sidecar 配置（已启用）

`src-tauri/tauri.conf.json` 的 `bundle` 中已添加 sidecar 声明：

```json
{
  "bundle": {
    "externalBin": ["binaries/document-worker"]
  }
}
```

Tauri 自动追加 target triple 和 `.exe` 后缀，实际查找 `src-tauri/binaries/document-worker-x86_64-pc-windows-msvc.exe`。

**打包流程**：
1. `cd tools/document-worker && .\build.ps1` — PyInstaller 打包
2. `.\copy-sidecar.ps1` — 复制到 Tauri sidecar 目录
3. `npm run tauri build` — 打包生产安装包

当前开发期也可直接使用 `python -m document_worker`（未找到 exe 时自动回退）。

## 超时实现

使用 `try_wait` + sleep loop 实现 30 秒超时，不引入额外依赖。超时后 kill 子进程并返回错误。

## 当前状态

| 组件 | 状态 |
|------|------|
| Python sidecar 架构 | ✅ 完成 |
| PDF/DOCX/XLSX 文本解析 | ✅ 完成（PDF 预览含 PyMuPDF/pdfplumber/pypdf fallback） |
| SymPy 数学计算 | ✅ 完成 |
| Rust 数学输入安全边界 | ✅ 完成（长度、操作枚举、变量、字符、标识符、token、括号深度） |
| 子进程环境白名单 | ✅ 完成（exe 与 Python fallback 均先 env_clear） |
| Rust/Tauri command | ✅ 完成 |
| 前端 service 封装 | ✅ 完成 |
| JSON schema 三端对齐 | ✅ 完成 |
| Worker 路径定位 | ✅ 完成（开发期：env → dev） |
| 30 秒超时 | ✅ 完成，Tauri command 使用后台线程避免 UI 卡死 |
| 生产分发策略 | ✅ 已确定（PyInstaller exe sidecar，用户无需 Python） |
| Tauri sidecar 配置 | ✅ 已启用（`externalBin` 已写入 `tauri.conf.json`） |
| PyInstaller 打包脚本 | ✅ 已完成（`tools/document-worker/build.ps1` + `copy-sidecar.ps1`） |
| 上传 UI / 文件选择 | ✅ 完成（设置页实验入口，原生文件对话框） |
| 解析预览页 | ✅ 完成（支持多文件预览，导航切换不丢失当前会话内预览） |
| 私有资料确认入库 | ✅ 完成（预览 → 确认导入 → SQLite private draft → 已导入列表管理） |
| 私有知识库 RAG | ✅ 已完成 MVP keyword/simple scoring 闭环（ToolAgent 对话时自动检索私有资料，sourceType 区分来源） |
| 私有资料 embedding / sqlite-vec | ❌ 未开始 |
| OCR（扫描件） | ❌ 未开始 |

## 当前非目标（本轮不做）

- 没有私有资料 embedding 或 sqlite-vec 向量检索（当前为 keyword/simple scoring）
- 没有 OCR 支持
- 没有把解析结果写入内置 Pack
- 没有上传文件到云端
- 没有多平台交叉编译（当前只做 Windows x86_64）

## 后续任务顺序

1. **解析质量继续打磨**：针对真实 PDF/DOCX 样本修复乱码、超时和复杂版式降级
2. ~~**用户确认后进入 private draft**~~：✅ 已完成
3. ~~**私有知识库 RAG**~~：✅ 已完成 MVP keyword/simple scoring（搜索时合并内置 Pack + 私有文档，subject 隔离）
3b. **私有资料 embedding / 向量检索**：后续接入 embedding provider 后升级为语义搜索
4. ~~**PyInstaller 打包脚本**~~：✅ 已完成（`tools/document-worker/build.ps1`）
5. ~~**Tauri sidecar 集成验证**~~：✅ 已完成（`externalBin` 配置 + `worker.rs` sidecar 优先路径）
6. **可选 OCR**：扫描件 PDF 图片文字识别（需引入 Tesseract 或 PaddleOCR）

## 待决策

- **D-109**：私有文档解析结果存 SQLite 还是只作为临时缓存？
- **D-110**：私有题库是否允许用户导入真题，如何做版权责任提示？
