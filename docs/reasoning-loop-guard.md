# CoT 循环守卫集成

[English](reasoning-loop-guard.en.md)

## 目标与交付边界

在大段重复思考进入会话记录前抑制重复，保留最早原文代表和未被证实重复的新内容。正常推理立即透传，疑似重复才缓冲；确认重复和取消调用使用不同门槛，允许短暂重复后恢复或正常调用工具。识别延迟内的少量重复可能已经提交，不回滚旧记录，不承诺语义循环的零污染。

Core 负责 prepared-call 能力、提交门控及单调用取消／恢复所有权；检测策略作为现有 repeat-tool-reminder 插件的显式可选配置，原工具提醒默认行为不变。当前集成不修改已安装应用或用户 Profile；开发源码验证与 NEXT 成品生效是独立阶段。

## 能力与上下文

- 仅对适配器明确保证可编辑及安全重建的同代 prepared call 启用删改。能力未知及 opaque 签名路由保守处理，不能仅按模型名或暂未观察到签名推断。
- DS Messages 保留原生签名思考，不声明可编辑。pi-ai 的 `reasoningReplay: plain` 是显式选择，不是全局默认；该模式必须拒绝不能安全解释的签名／重放数据。
- 在 plain 模式中，只有思考、没有正文或工具的安全前缀可按原文作为 assistant 文本进入下一次 wire 请求，避免上游忽略 reasoning-only 消息。正常带工具的思考按原字段回放；此表示变化不生成新的推理内容。
- 使用既有 `interrupted` 字段表达流中断后保留的安全前缀，不把循环策略中断伪装成用户取消或自然完成。该持久语义扩展及 SDK／UI 读者验证由 Core 维护；旧历史不改写。

## 提交与工具约束

过滤后的内容必须同时作为流记录、组装块与界面通知的来源。后续 `block-end` 不能恢复已删除副本，不能为维持签名而保存第二份原始大段重复日志。缓冲、检测窗和元数据设总上限；上游 SDK 自己保留的响应内存不属于 Core 门控的内存保证。

工具承诺文字、零散工具头或可解析的 JSON 都不构成可执行调用。真实完整工具块出现后给予有界结算机会：`settlementBudget` 按后续事件数与新增 delta 的 UTF-16 字符数消耗，不能通过持续输出避开 idle 超时。超限以 `TOOL_SETTLEMENT_LIMIT` 失败，不执行该调用的工具，也不自动续跑。正常执行仍须原有成功终态、验证及授权。不得伪造 finish、补造未完成工具，或用正文／工具事件释放已确认的重复副本。

本地守卫中断在调用清理成功且未被用户／父级／销毁取消时，才可预算内续跑。提示词以专属来源真实记录，同一原生子代理 activation 在最终结算前恢复；不依赖全局 idle 监听抢投。外部 Codex、ACP、Claude Code 不自动受父宿主过滤覆盖；DSH SDK 子进程需要内部接入。

## 版本绑定补丁

[补丁导出器](../dsh-desktop-next/scripts/reasoning-loop-patches.mjs)读取独立 Core 工作区已构建的发布运行文件，与当前 [vendored manifest](../vendor/dsh-runtime/0.2.1-alpha.3/manifest.json)中的精确归档对比。它核验版本、基线提交及归档摘要，逐文件自检补丁可还原目标字节，并生成输入／输出 SHA-256 清单；不会改依赖、锁文件、Profile 或封存载荷。缺失构建文件不转换为删除补丁，已有输出不覆盖。

在 NEXT workspace 目录执行，参数均为本次选择的真实路径：

```sh
node scripts/reasoning-loop-patches.mjs --core-root <已构建的独立-Core-工作区> --output <新的补丁输出目录>
```

导出是候选补丁，不代表运行时已接入。评审产物后，沿用 root resolutions 的版本化 `patch:file` 机制及对应锁文件，将补丁应用在依赖准备阶段，再按 [payload 准备流程](../dsh-desktop-next/scripts/prepare-payload.ts)复制并封存。不能在 `sealPayload` 后改字节，也不能把未经依赖解析的旧 node_modules 当作已生效版本。不得为此修改 Desktop 固定子模块或篡改上游来源 SHA。

## 自动构建接入

本地 NEXT `build` 与 `dist:win` 入口先运行以下补丁校验，通过后才继续编译或打包；`package:dir` 通过 `build` 继承校验。根目录构建／打包命令最终进入这些 workspace 入口，不依赖远端 CI 才能发现补丁缺失。

```sh
corepack yarn workspace dsh-desktop-next verify:reasoning-loop
```

校验检查十二包版本、24 个 resolutions、候选及有效补丁对应关系、已安装发布文件的 SHA-256，并覆盖导出器与 Git 可应用性。构建不从本机 Core 路径重新生成补丁；输入是仓库中的版本化补丁、清单、vendored 归档与锁文件。升级 Core 时需重新评审并更新整组输入，不能绕过失败继续打包。

交付时须一起提交这些输入及校验测试／导出器；仅上传压缩包不会接入构建。现有 CI 构建 Windows 安装包但不发布。打包包含守卫能力不等于默认启用：`reasoningLoop` 与适配器 plain 模式仍需显式选择，不自动改写用户 Profile。

## 验收与状态

验收包括正常长推理、无换行／短句重排循环、标识符与否定词变化、巨型增量分包一致性、短暂重复后工具成功、长循环终止、完整块回灌、签名拒绝、清理失败、普通 always 重试隔离，以及原生子代理父级取消时不复活。可见行为需要真实 Loader 组合与 keyless 会话快照；wire 投影使用本地假服务检查，不等同真实模型验证。

Core 源码实现与定向验证已完成，包含重复抑制、恢复、原生子代理、会话读者及真实 Loader／SDK 的 keyless 快照。本轮按验收修正后重新导出：可见停滞改为每字符硬上限（`maxWindowChars`，到达上限时以当前证据决定中断或释放）、新增复现句子字符质量门槛（`unitCharShare`，使仅反复出现的口头填充词无法单独触发判定）并让围栏代码暂停检测；实测局限随之记录：在依据的录制会话中，106 条超过 2,000 字符的推理块有 7 条越过阈值，其中一条在阈值之后仍重复约 4,000 字符才自行恢复。NEXT 补丁导出器通过隔离测试与类型检查，十二个候选包的补丁通过精确归档指纹及独立 Git 可应用性检查，记录见 [补丁清单](../patches/reasoning-loop/0.2.1-alpha.3/reasoning-loop-patches.json)。十二包现已提升为 root `patches/<package>@<version>.patch`，通过 24 个版本精确／范围 selector 的 Yarn `patch:file` resolutions 和锁文件安装到本地依赖树；41 个运行文件与清单的输出摘要全部一致。本轮把 Chat 客户端 bundle 与新增实时检测阶段的全部消费方纳入候选集：循环在提供方清理前发布策略失败，guard 在每个 episode 仅一次地报告真实缓冲迁移（疑似／放行／屏障）且不进入模型输出，Chat 行保留已交付前缀、显示续跑序号与 Turn 上限，不会把正在续跑的 Step 呈现为已停止，Host 桥在重连时复原当前 live 阶段。候选补丁与 root 有效补丁逐字节一致，导出器不再在文件 diff 之间插入分隔空行。守卫仍须显式配置启用，用户 Profile 和现用应用均未修改。真实 DS 大上下文行为、阈值准确率和守卫的成品启用效果仍需独立验证，不能由静态代码或合成样本推定。
