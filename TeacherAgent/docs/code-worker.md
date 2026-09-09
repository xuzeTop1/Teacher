# Code Worker — Python 代码执行（Guardrails，非 Sandbox）

## 安全分类

**Phase 1 = 教学护栏（guardrails），不是安全沙箱（sandbox）。**

纯 Python wrapper（exec + restricted builtins）存在不可封堵的 CPython 级逃逸：
- `object.__subclasses__()` → `warnings.catch_warnings` → warnings 模块 → 真实 builtins → `open` / `__import__`
- `__closure__` / `__globals__` 是 function type 的只读 descriptor，纯 Python 无法删除
- CPython 类型层级在 C 层面维护，exec 环境无法重置

**结论**：Phase 1 仅适用于可信本地开发代码，不可用于执行普通学生输入或其他不受信代码。当前实现 fail-closed：

- Release 构建无条件关闭代码执行。
- Debug 构建也默认关闭；只有同时设置 Rust 侧 `TEACHER_AGENT_ENABLE_TRUSTED_CODE_RUNNER=1` 与前端 `VITE_ENABLE_TRUSTED_CODE_RUNNER=1` 才显示并启用可信开发入口。
- Rust 在启动 worker 前拒绝未授权请求；Python worker 自身再做一次相同的显式 opt-in 检查。
- 错误固定说明“当前环境未启用安全隔离，不能执行不受信代码”。

这不是 OS 级隔离。真实安全执行仍必须迁移到 OS 级隔离或 WASM/容器。

Phase 2 候选方案：
- Windows Job Object（限制子进程创建、资源配额）
- seccomp / pledge / unveil（syscall 过滤）
- WebAssembly sandbox（Wasmtime / WasmEdge）
- Container isolation（gVisor / Firecracker）

## 架构

```
Tauri/Rust → 固定命令行（仅 `run`）→ JSON stdin → code-worker.exe / python -m code_worker → JSON stdout
```

- Python worker 是独立进程，不嵌入 Tauri 主进程
- Rust 只通过 stdin 传递 JSON；学生代码、stdin 和 API Key 不进入命令行参数
- Rust 启动 sidecar 时使用环境变量白名单；Python 执行子进程再次使用最小白名单，且不向执行代码的子进程传递 `PATH`
- 代码在受限子进程中执行，使用 restricted builtins dict（不含 `__import__`/`open`/`eval`/`exec`/`compile`）
- 输入只通过 stdin 传入
- wrapper 占位符使用单次替换渲染，插入的代码、stdin 和测试输入不会被后续占位符再次扫描

## Phase 1 护栏（非安全边界）

以下护栏阻止**意外误用和初学者错误**，但不阻止有经验的攻击者：

| 层 | 护栏 | 绕过方式 |
|---|---|---|
| L1 | OS 子进程边界 | 学生代码在独立 Python 进程中运行 |
| L2 | Restricted builtins dict | `__builtins__` 是纯 dict，不含 `__import__`/`open`/`eval`/`exec`/`compile`。所有条目均为 C 级对象 | `object.__subclasses__()` → `catch_warnings` → warnings → 真实 builtins |
| L3 | Import guard | `builtins.__import__` 被替换，BLOCKED_MODULES 中的模块被拦截 | 同上路径恢复真实 `__import__` |
| L4 | Pruned sys.modules | 只保留 sys、io、builtins 等 | `catch_warnings` 作为 object 子类仍存活 |
| L5 | os/subprocess 阻断 | os.system/popen/execv/spawnv 全部拦截 | 通过 L2 恢复真实 import 后绕过 |
| L6 | 超时 + 返回输出限制 | timeout 1-30s，Python stdout/stderr 各截断到 64KB；Rust IPC 边界再将 stderr/error/warnings 清洗并限制到 4K 字符；超时后 best-effort 清理进程树 | 不是 OS 资源配额，可信代码仍可在超时前消耗本机资源 |

**回归测试**（`test_runner.py::TestSecuritySubclassesEscape`）：
- `test_subclasses_catch_warnings_exists`：验证 `catch_warnings` 可通过 `__subclasses__()` 到达
- `test_subclasses_escape_can_recover_open`：验证完整逃逸链（可能因 Python 版本而异）
- `test_subclasses_escape_can_recover_import`：验证完整逃逸链
- `test_known_escape_documented`：标记逃逸为已知 Phase 1 限制

| 约束 | Phase 1 实际状态 |
|------|-----------------|
| 语言 | 仅 Python |
| 超时 | 由调用方指定（clamp 1-30s），Rust watchdog = input.timeoutMs + 2s |
| 网络 | 护栏阻止（import guard），但可通过 `__subclasses__` 逃逸绕过 |
| 文件 I/O | 护栏阻止（`open` 不在 builtins），但可通过 `__subclasses__` 逃逸恢复 |
| import | 护栏阻止（`__import__` 不在 builtins），但可通过 `__subclasses__` 逃逸恢复 |
| shell/子进程 | 护栏阻止（subprocess stub + os 阻断），同上 |
| eval/exec/compile | 不在 restricted builtins 中 |
| 输出截断 | Python stdout/stderr 返回值各 64 KB；Rust 返回前移除诊断中的 ANSI/控制字符、绝对路径和常见 API Key/Bearer 形态，并将单项诊断限制到 4K 字符；stdout 仍按原始教学输出返回。这不是磁盘、内存或写入速率的 OS 级配额 |
| 进程树清理 | 超时后 Windows 使用 `taskkill /T /F`，POSIX 使用进程组 `SIGKILL`；仅为 best-effort 清理，不是禁止创建子进程的隔离边界 |

## CLI 用法

```powershell
# 开发期（Python 模块）
echo '{"code":"print(1+1)","timeout_ms":5000}' | python -m code_worker run

# 显式可信 Debug 模式（PowerShell）
$env:TEACHER_AGENT_ENABLE_TRUSTED_CODE_RUNNER = "1"
$env:VITE_ENABLE_TRUSTED_CODE_RUNNER = "1"
'{"code":"print(1+1)","timeout_ms":5000}' | code-worker.exe run

# 带测试用例
'{"code":"print(2)","test_cases":[{"name":"t1","expected_output":"2"}]}' | code-worker.exe run
```

## PyInstaller 打包

```powershell
cd tools/code-worker
.\build.ps1          # 生成 dist/code-worker.exe
.\copy-sidecar.ps1   # 复制到 src-tauri/binaries/
```

当前 PyInstaller exe 是 code-worker 分发入口，内部仍会自动查找系统 Python 解释器来运行受限 wrapper；因此目标机器仍需安装 Python 3.10+。
查找顺序：`sys._base_executable` → `sys.base_prefix` → PATH → 常见安装目录。
每个候选路径会执行 `python --version` 验证可用性。

## JSON Schema

### 输入（仅 stdin）
```json
{
  "code": "print('hello')",
  "stdin": "",
  "test_cases": [
    {"name": "test_add", "input": "", "expected_output": "2"}
  ],
  "timeout_ms": 5000
}
```

`memoryLimitMb` / `memory_limit_mb` 当前会被明确拒绝。项目尚未实现 OS 级内存隔离，不能接受参数后假装已执行限制；真正内存配额继续归入 D-112。

### 输出（stdout）
```json
{
  "ok": true,
  "exit_code": 0,
  "stdout": "hello\n",
  "stderr": "",
  "test_results": [
    {"name": "test_add", "passed": true, "actual_output": "2", "expected_output": "2"}
  ],
  "runtime_ms": 42,
  "error": null,
  "warnings": []
}
```

## Worker 路径定位

与 document-worker 相同的优先级：

| 优先级 | 场景 | 查找方式 |
|--------|------|---------|
| 1 | 生产期 | 当前可执行文件同目录，查找 `code-worker-x86_64-pc-windows-msvc.exe` 或 `code-worker.exe` |
| 2 | 开发期（手动放置 exe） | `src-tauri/binaries/` 下 |
| 3 | 开发期（Python） | 环境变量 `TEACHER_AGENT_CODE_WORKER_DIR` |
| 4 | 开发期默认 | 项目根目录 `tools/code-worker` |

## 安装依赖

```powershell
cd tools/code-worker
python -m pip install -e ".[dev]"
```

## 运行测试

```powershell
cd tools/code-worker
python -m pytest tests/ -v
```

## 打包

```powershell
cd tools/code-worker
.\build.ps1          # PyInstaller 打包
.\copy-sidecar.ps1   # 复制到 Tauri sidecar 目录
```

## 当前状态

| 组件 | 状态 |
|------|------|
| Python sidecar 架构 | ✅ 完成 |
| 教学护栏（restricted builtins/import guard/pruned modules） | ✅ 完成（非安全沙箱，见安全分类） |
| 超时控制（1-30s 透传） | ✅ 完成 |
| 测试用例执行 | ✅ 完成 |
| Rust/Tauri command | ✅ 完成；Release fail-closed，Debug 需双重显式 opt-in |
| Windows 无控制台启动 | ✅ 完成（Rust sidecar 与 Python 子进程均使用 `CREATE_NO_WINDOW`） |
| 前端 service 封装 | ✅ 完成 |
| 编程学科 Python 练习台 | ✅ UI 完成；生产默认禁用并显示未启用安全隔离 |
| ToolAgent 路由 + SocraticAgent 意图 | ✅ 完成 |
| PyInstaller 打包 + sidecar 集成 | ✅ 完成（8MB exe，自动查找系统 Python；目标机器仍需 Python 3.10+） |
| 端到端 smoke test | ✅ 通过（算术/报错/语法错误/测试用例/超时） |
| TypeScript/JavaScript 支持 | ❌ Phase 2 |
| OS 级安全沙箱（Job Object/seccomp/WASM） | ❌ 未实现；因此禁止不受信代码 |
| stdin-only 进程传输 | ✅ 完成；命令行不含学生代码 |
| 子进程环境白名单 | ✅ 完成；不继承 Provider/云/代理/SSH/数据库凭据，执行代码的 Python 子进程不含 `PATH` |
| wrapper 单次渲染 | ✅ 完成；用户值中的 `__USER_CODE__` / `__MAX_OUTPUT__` 等文本不会触发二次替换 |
| OS 级内存限制 | ❌ 未实现；相关输入字段直接拒绝，不静默接受 |

Python 练习台只在 `programming` 学科中显示，直接复用 `run_code` Tauri command，不创建第二套执行器。界面必须持续标明“未提供 OS 级隔离”“生产默认关闭”“仅可信开发模式可用”。普通学生消息即使触发 ToolAgent，也只会得到 fail-closed 错误，不会启动 worker。

## 当前非目标

- 不做任意 shell 执行
- 不做联网 pip 安装
- 不做完整在线 IDE
- 本次不宣称已实现 OS 级沙箱；在可验证隔离完成前持续 fail-closed
- 不做自动代写整题答案
- 不做 TypeScript/JavaScript（Phase 2）
