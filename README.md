# 隐私优先的多端协同智能学习辅导系统

**中文** | [English](README.en.md)

一个隐私优先、本地优先的多端 AI 学习辅导系统：桌面端 **TeacherAgent** 提供私有文档 RAG、知识管理与智能辅导，手机端 **AlertTime** 负责学习行为采集与端侧分析，并通过局域网同步形成「采集 → 评估 → 建议 → 决策回传」闭环。

## 隐私约束

- 原始学习记录与核心业务数据默认存储于用户本地设备；
- 跨设备同步仅发生在用户私有局域网内（家庭 WiFi / 手机热点 / USB 共享），无任何云端账户；
- 端侧学习分析仅在用户显式配置外部兼容服务时，发送经字段白名单过滤的数据（不含日记正文、备注与任何密钥）；
- API 密钥经操作系统凭据管理器存取，数据库与备份文件不落明文秘密；
- 备份协议与同步协议完全隔离，互不混用。

## 仓库结构

```
TeacherAgent/   桌面端（Tauri 2.x + Vue 3 + Rust）
AlertTime/      手机端（Kotlin + Jetpack Compose + Room）
```

## 核心能力

### 桌面端 TeacherAgent

- **本地知识管线**：大模型生成的教育内容经格式、事实、审核多级校验后纳入本地知识库；
- **私有文档 RAG**：导入讲义/试卷切分为片段，嵌入向量存于 SQLite；千级规模采用暴力余弦检索（release 构建约 5 ms/千向量），无外部向量数据库依赖；
- **BKT 知识追踪**：对「学生—知识点」维护可解释的掌握概率，作为建议生成的状态输入（参数为手工默认值，拟合列为后续工作）；
- **局域网同步服务端**：HTTPS 自签证书 + SPKI 指纹二维码配对、一次性令牌换发设备凭据、消息信封严格校验、快照幂等。

### 手机端 AlertTime

- **专注采集**：专注计时、分心检测、计划与周目标管理；
- **端侧学习分析**：可选调用用户自配的 OpenAI 兼容服务，端点策略强制约束（无认证仅限回环/私有网段，带密钥强制 HTTPS）；失败自动降级本地确定性评估；同步按输入内容指纹复用近期分析，稳态链路不等待模型；
- **本地备份**：全量 JSON 导出/合并恢复，与同步协议完全隔离。

### 同步协议

单一信封格式（`format`/`schemaVersion`/`messageType`/`deviceId`），端点与消息类型一一对应，未知字段忽略以保前向兼容；快照携带幂等 ID；建议稿按游标分页拉取，采纳/拒绝决策回传确认。协议文档、JSON Schema 与测试夹具在两个子目录各存一份、逐字一致，由脚本做 SHA-256 清单校验，Rust/Kotlin 双端解析器共享同一组夹具。

## 快速开始

```bash
# 桌面端（需要 Node.js 18+ 与 Rust 工具链）
cd TeacherAgent && npm install && npm run tauri dev

# 手机端（需要 JDK 17+ 与 Android SDK）
cd AlertTime && ./gradlew assembleDebug
```

桌面端「AlertTime 同步」页开启局域网服务并生成二维码，手机端扫码配对后即可同步。

## 测试与基准

- 前端 Vitest 测试文件 70 个；桌面端 Rust 单元测试 297 个；移动端 JVM 单元测试 37 个文件 + 仪器测试 14 个文件；
- 协议双端对偶测试共享同一组合法/畸形夹具，SHA-256 镜像校验阻断单侧漂移；
- 基准脚本：`TeacherAgent/scripts/sync-benchmark.py`（同步链路：配对/规模/建议稿闭环/鲁棒性）、`TeacherAgent/scripts/rag-index-benchmark.py`（暴力余弦 vs FAISS HNSW 对照）。

## 发布版

下载预构建安装包见 [Releases](https://github.com/xuzeTop1/Teacher/releases)（桌面端 setup.exe / MSI，手机端 debug APK）。桌面端安装程序未做代码签名，SmartScreen 提示时选择「仍要运行」即可。

## 许可证

本仓库代码保留所有权利（All rights reserved）。
