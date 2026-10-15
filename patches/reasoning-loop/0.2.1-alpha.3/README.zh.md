# CoT 循环守卫运行包补丁

本目录是尚未应用的候选补丁，目标包版本为 `0.2.1-alpha.3`，输入是 vendored Core 提交 `f43a201de78c2926820a6670bbb8b653a39b0308` 的精确归档。

## 内容

七个包分别覆盖 LLM 能力与规范化内容块、Agent 策略类型、Agent Loop 单调用中断及恢复、Session 前缀语义、repeat-tool-reminder 的可选思考策略、原生 DeepSeek opaque 能力和显式 pi-ai plain 模式。`reasoning-loop-patches.json` 记录每个输入归档、补丁及变更后文件的 SHA-256。

测试、SDK 夹具、持久类型确认、ADR 和窄范围 Windows 快照支持修复保留在独立 Core 源码工作区，不属于生产运行包补丁。本补丁集不修改 Desktop 固定子模块，不把未提交改动冒充上游提交，也不改变 Session 格式版本 4。

## 已验证

- 补丁导出器隔离测试及 NEXT 类型检查。
- 七个包的归档／补丁／输出指纹均与冻结的 Core 构建文件一致。
- 每个补丁均对精确基线包的隔离副本执行 `git apply --check`。
- 源码层重复抑制、中断／恢复、工具和原生子代理定向测试。
- 真实 Loader headless 与 SDK keyless 重放，且存在 notifications 及最终 result 的 golden 断言。

以上不等同真实模型或成品运行验证。默认采用保守、显式启用策略，不表示所有模型均受支持。原生 DS Messages 签名仍为 opaque；受支持的 Chat Completions plain 模式必须显式选择。用户现有 Profile 未改。

## 集成边界

本候选目录刻意与当前有效的 root `patches/<package>@<version>.patch` 查找位置分开，现用应用和依赖树不会加载它。

候选经过评审并提升后，root resolutions 须经由版本化 Yarn `patch:file` 机制引用精确的既有 vendored 归档，并一致解析锁文件。补丁在依赖准备阶段应用，然后复制及封存 payload；不得修改已封存载荷、手工替换安装目录文件，或把未更新的 node_modules 当作补丁已生效。

运行时可选配置及路由要求见 Core 的 repeat-tool-reminder 和 llm-pi-ai README。Desktop 接入状态及导出器见[集成说明](../../../docs/reasoning-loop-guard.md)。
