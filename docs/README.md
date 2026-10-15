# DSH Desktop 文档

[English documentation](README.en.md)

这里是 DSH Desktop 的产品与开发文档入口。根目录的 [`README.md`](../README.md) 适合第一次了解项目；本目录解释项目为什么存在、如何使用，以及如何为 Desktop 编写插件。想参与贡献？见[参与贡献](../CONTRIBUTING.md)。

## 按目标阅读

普通用户从[用户指南](user-guide.md)开始即可，不需要阅读开发者文档。

### 用户文档

| 文档 | 你会得到什么 |
| --- | --- |
| [用户指南](user-guide.md) | 安装、profile、模式、终端、插件命令和更新 |
| [常见问题](faq.md) | 支持平台、内置环境、官方边界、数据、插件和更新的直接回答 |
| [隐私政策](../PRIVACY.zh.md) | 官方更新、下载、本地数据、第三方服务与用户选择 |
| [为什么做 Desktop](why-desktop.md) | Desktop 与官方 Harness 的边界，以及为什么坚持插件化 |

### 开发者与维护者文档

| 文档 | 你会得到什么 |
| --- | --- |
| [插件生态倡议书](plugin-ecosystem.md) | 开放、可组合、可持续的插件生态愿景与三条原则 |
| [插件开发](plugin-development.md) | 普通 DSH 插件、Desktop 服务、兼容模式和生命周期 |
| [Community Fabric Draft](../dsh-community-fabric/README.zh.md) | 从 Manifest/Capability 基础，到 Runtime/Presentation、service composition 和溯源诊断的社区互操作提案 |
| [Fabric 社区意见处置记录](../dsh-community-fabric/docs/research/community-issue-23-review.zh.md) | Issue #23 中哪些建议已采纳、拆成独立 RFC、延期或不进入可移植核心 |
| [Fabric 框架与插件需求调研](../dsh-community-fabric/docs/research/mature-plugin-frameworks.zh.md) | Koishi、Chrome、VS Code 的成熟模式，以及真实 DSH 插件的功能需求 |
| [VS Code 扩展模型调研](../dsh-community-fabric/docs/research/vscode-extension-model.zh.md) | VS Code 已实现的声明、Provider、UI、运行位置和生命周期模式，以及它们对 Fabric RFC 的具体约束 |
| [Community Market 设计](../dsh-community-market/README.zh.md) | 规划中的插件市场壳、可扩展目录来源、用户选择、安装确认和安全边界 |
| [Market 目录提供方合同](../dsh-community-market/docs/catalog-provider-contract.zh.md) | 面向后续实现团队的 Schema、query 参数、多来源和适配器规范 |
| [上游同步维护](<upstream-sync.md>) | 必须保留的补丁、不可回导内容、产物同步顺序和回归矩阵 |
| [历史架构参考](<architecture.md>) | 早期 Stable/Beta 设计背景，不是当前产品支持清单 |
| [NEXT 包级参考](<../dsh-desktop-next/README.zh.md>) | 当前 Windows x64 构建、运行、发布与已知限制 |

## README 文件怎么分工

目前外层仓库有两份正式的产品 README，另保留一个旧链接兼容入口：

- [`README.md`](../README.md)：中文产品入口。
- [`README.en.md`](../README.en.md)：英文产品入口，与中文 README 保持同一产品范围。
- [`README.zh.md`](../README.zh.md)：旧中文路径的兼容页，不维护独立内容。

[README 双语记录](<../README.i18n.yaml>) 只记录正式产品入口的 hash，不是用户指南。当前技术参考由 [NEXT 包级说明](<../dsh-desktop-next/README.zh.md>) 和[上游同步维护指南](<upstream-sync.md>)维护；已删除的旧包及其服务文档不能作为恢复旧实现的依据。维护者决策记录保留历史取舍，不替代当前产品文档。

Core 子模块固定到[来源记录](<../upstream.json>)中的维护提交，保留上游源码结构和本项目必要补丁。其文档属于 Core，不是 Desktop 产品文档；不能仅凭相同 npm 版本号认定为未修改的官方发行包。

## 状态约定

文档应区分已实现能力、平台限制、未验收项目和 roadmap。当前产品入口是 Windows x64 NEXT，实际组成与验收命令以 [NEXT 包级说明](<../dsh-desktop-next/README.zh.md>) 为准；早期 Stable/Beta 的平台、窗口模式和 API 描述只作历史参考，不能据此恢复旧目录、旧通道或其它平台支持。
