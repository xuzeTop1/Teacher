# Android 用户自带 Provider 网络边界

日期：2026-08-11  
范围：AlertTime 手机端独立学习分析 Provider；不改变 TeacherAgent 桌面 Provider 实现或同步协议。

## 背景

AlertTime 的 `targetSdk=36` 默认不允许 cleartext。此前测试把 RFC1918 HTTP Provider 视为可用，
但 Manifest 没有平台许可；同时 HTTP 请求路径允许 Bearer/API Key，可能把密钥明文发送到局域网。

## 决策

1. 认证方式增加用户显式选择的 `none`（“无认证（本地服务）”）。`none` 不发送任何认证 Header，
   且 `apiKey` 必须为空；只用于用户信任的 loopback/RFC1918 服务。
2. Bearer 和 `api-key` 只允许 HTTPS，Key 只能写入各自 Header。公网 HTTP、URL credentials、query、
   fragment、非 `/v1` 根地址均拒绝，HTTP 客户端不跟随重定向。
3. 为支持动态私网地址上的 `none` HTTP，Android 使用最小 app-wide cleartext 平台许可。该许可不是
   地址白名单；AlertTime 的 `EndpointPolicy` 仍是唯一请求入口，并同时检查 `none`、loopback/RFC1918。
   任何带密钥模式仍强制 HTTPS，TeacherAgent 的局域网同步 HTTPS 与证书 pin 不受影响。
4. Provider Store 切换到 `none` 时，在同一 Room 事务中先写非敏感配置、删除旧密文、最后启用；切回带密钥
   模式必须重新填写或使用仍存在且可解密的密文。无认证模式不解密、不返回 Key。

## 影响与验收

- Android UI 明示 HTTP 不加密且不得携带 Key；Key 不回填、不进入 JSON 正文、日志或备份。
- 请求契约测试覆盖私网 HTTP+none 无认证 Header、HTTPS+none、HTTPS 两种带密钥、带密钥 HTTP 拒绝、
  公网 HTTP 全模式拒绝和空 Key fail-closed。
- 该决策不代表真实 Provider、TLS、代理或设备网络已验收；真实验证仍按手机端设备清单执行。
