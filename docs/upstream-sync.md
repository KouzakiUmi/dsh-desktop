# 上游同步维护指南

[English](<upstream-sync.en.md>) · [当前 NEXT 包级说明](<../dsh-desktop-next/README.zh.md>)

本指南记录维护分支相对上游的必要差异，供后续合并、升级和裁剪时核对。它不是历史 Stable/Beta 产品的恢复清单；旧目录、旧补丁或旧文档仍存在，也不代表应重新启用。版本与包数量是当前基线，不是未来升级的永久上限。

## 1. 先确定修改归属

| 范围 | 当前约束与权威记录 |
| --- | --- |
| Core | 保留上游多平台源码；在独立 Core 工作区维护补丁并提交，再推进 Desktop 子模块，不从 Desktop feature branch 修改子模块内的 tracked 源码。当前已推送基线为 [f43a201](https://github.com/KouzakiUmi/deepseek-harness/commit/f43a201de78c2926820a6670bbb8b653a39b0308)。 |
| Desktop pin 与包来源 | [upstream.json](<../upstream.json>)、[子模块配置](<../.gitmodules>)、[runtime manifest](<../vendor/dsh-runtime/0.2.1-alpha.3/manifest.json>) 必须指向同一维护 Core 提交；包版本号相同不能代替来源提交与校验和。 |
| NEXT | 仅 Windows x64。窗口、终端、更新、权限、打包、解释器载荷和图标由 NEXT 维护，不重新引入其它平台入口。 |
| 借用实现 | [upstream-reference.json](<../dsh-desktop-next/upstream-reference.json>) 记录上游文件及原始 SHA-256；它不是本地适配文件必须等于上游的声明。逐文件合并，不整目录覆盖本地 Windows 适配。 |
| 包管理 | 外层 Yarn 4.18.0 与子模块 pnpm 分离。外层 [架构配置](<../.yarnrc.yml>) 只安装 win32/x64 可选依赖；不能靠删除 Core 的其它平台源码来瘦身。 |
| AA / Market | 使用各自的准备脚本、来源记录和兼容补丁；它们不是再复制一套 Core 或主前端的理由。 |

NEXT 使用固定 Core 的主前端及扩展点，不维护另一套主前端。当前 Core 的价格渲染修复属于 Core 源码补丁，不应改成 Desktop 内平行的 Markdown renderer。

## 2. 必须保留或有证据地替换的差异

| 差异 | 保留的行为与核对位置 |
| --- | --- |
| pi-ai 1.2.0 精简适配 | [Yarn 补丁](<../patches/pi-ai@1.2.0.patch>) 在六个 provider 模块中删除七行 delta 阶段的重复部分 JSON 解析；保留参数文本累积及完成阶段解析。Core 的 pnpm 补丁与此保持语义一致。不要带回 0.87 分支或 1.1 时代的大块兼容覆盖。用 `yarn why @earendil-works/pi-ai` 核对实际只有目标版本及目标补丁。 |
| 美元价格与公式 | [Core currencyAwareMath](https://github.com/KouzakiUmi/deepseek-harness/blob/f43a201de78c2926820a6670bbb8b653a39b0308/packages/client/ui-primitives/src/markdown/currencyAwareMath.ts) 与对应 parser、单测、真实消息渲染测试一并保留。价格、CJK、`between $5 and $10 (see $x$)` 不应吞成公式；`$x$`、`$2+2$`、带合法 padding 的公式及块公式仍须可用。不能以禁用数学渲染替代修复。 |
| ZIP 调用面安全 | Windows Node、Python wheel 等下载解压前校验归档来源与摘要，并在 entry 回调拒绝 symlink、设备及其它特殊 Unix 文件类型。Unix mode 位是归档安全元数据，不是可删的 macOS/Linux 产品支持代码。保留真正恶意 ZIP 的负向测试。 |
| 目录别名安全清理 | [disposable-tree.ts](<../dsh-desktop-next/adopted/src/disposable-tree.ts>) 不只信任 `lstat().isSymbolicLink()`：用 native realpath 比较条目和其真实父目录下的预期位置；目录别名只移除入口，不递归目标。普通 realpath 不能替代 native 版本；Windows 比较使用 `path.relative` 的大小写语义。 |
| 更新 UX 与退出握手 | [updates.ts](<../dsh-desktop-next/src/updates.ts>) 保持错误可见、失败 cache 初始化可重试、成功后不反复扫描；通知去重不等于自动安装。[installer.nsh](<../dsh-desktop-next/adopted/build/installer.nsh>) 保持可见安装和显式重启，per-machine 更新必须在 UAC 交接前等待旧应用退出，不得改回静默 `/S` 或只依赖提权内层检查。 |
| pnpm 发布年龄兼容 | [pnpm 补丁](<../patches/pnpm@11.28.5.patch>) 跟随当前 pnpm 代码重新定位，不直接套旧 11.8 构建。数字和数字字符串的零值行为一致，正值年龄仍生效；[兼容测试](<../scripts/pnpm-release-age.test.mjs>) 检查真实安装代码，不能通过关闭年龄策略或放宽信任策略来过关。解释器 smoke 在随包 pnpm 自己的目录运行，不继承外层 Yarn 工程的 cwd，也不关闭 package-manager 校验。 |
| Inspector 与 Electron 适配 | 活动补丁以 [root resolutions](<../package.json>) 和实际安装图为准，而非整个补丁目录。Inspector 构建 chunk 改名后重新定位 Reload DevTools 的 embedder callback，并保留 `test:inspector-compat`。其余 Windows/Electron 补丁逐个比较上游是否已修复，不能批量覆盖或删除。 |
| AA 桥接 | [Connector 补丁](<../patches/agents-anywhere-connector-httpx.patch>) 保留子进程 httpx 的裸 IPv6 bypass、父环境隔离、Connector 日志与 JSON 传输后一致的内容哈希。[AA policy](<../scripts/agents-anywhere-release-policy.mjs>) 统一维护五个 runtime peers，包含 Cordis/Schemastery；不要再在补丁里硬编码另一套旧 peer 范围。当前 Gateway 的事件订阅和回复必须使用同一个受 Context 生命周期管理的真实 Peer，不能传 undefined、借用浏览器 Peer 或靠函数 arity 猜测兼容。 |

升级依赖以当前同主版本安全修复为优先；必须区分生产图、开发图、临时 AA staging 图和已打包客户端代码。当前交付图中的 extract-zip 2.0.1 仍有 [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) 与 [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)：调用面防护不等于公告消失。不要排除包、忽略 advisory 或把弃用提示混同为漏洞清零。

Yarn 4.18.0 的递归审计遇到 patch:file 源描述符未绑定时可能内部断言失败，这不代表没有漏洞。若使用诊断适配，必须核对同版本实现，只把缺失的 file 描述符绑定到同 ident、同源路径且唯一的已登记 resolution；非 file 缺失或歧义必须失败。不得改全局 CLI、跳过图节点或省略完整原始报告；未来上游修复后应退休临时适配，而非长期依赖 minified 内部变量。

构建主机需要代理时，只对构建子进程复用已有配置。当前 electron-builder 26.x 打包链的下载器需要显式设置 `ELECTRON_GET_USE_PROXY=true`，并将已有代理映射到 `GLOBAL_AGENT_HTTP_PROXY` / `GLOBAL_AGENT_HTTPS_PROXY`；仅有普通 HTTP_PROXY 不代表该下载器已启用代理。保留 TLS 证书和归档摘要校验，不把本机代理地址或凭据提交到仓库。升级下载器后按锁定版本重新核对这些开关。

## 3. 不应回导的内容

- 不恢复 macOS/Linux 打包、签名、公证、universal/arm64 入口、Darwin Shell 环境捕获、macOS window material/traffic-light 处理、ICNS 与 tray template 图标；Windows 权限入口与原生来源选择仍需保留。
- 不恢复旧 Stable/Beta workspace、双变体同步器、旧通道 API 范围或已删除包的文档链接；不能为了修复断链而把整个旧产品复制回来。
- 不把 parameterized 文件过滤器、归档 mode 检查、第三方平台中立库或 Core 官方平台实现误删成“其它平台代码”。
- 删除工具依赖前同时检查 JS/TS、CSS import 和构建命令。shadcn 的唯一构建消费者是静态样式，已将其原始 CSS 与完整 MIT 许可保留为 [独立样式资产](<../dsh-desktop-next/adopted/src/native-ui/shared/shadcn-tailwind.css>)，由 [摘要与许可回归](<../dsh-desktop-next/tests/native-ui-asset.spec.ts>) 约束；不要为此重新引入整个 CLI 及闲置的旧 MCP SDK、ts-morph、fast-glob/micromatch/braces 链。
- 不把 SDK 必需 peer 的声明闭包当作新功能启用。Market 的 peer/dev cohort 必须与当前 Core 对齐；不能通过 optional、忽略 peer warning 或混装两套 Cordis 来掩盖缺失。
- 不添加新默认插件、旧 preset 或平行前端来绕过现有扩展点；新能力应按实际产品需要单独评估。

## 4. 安全的同步顺序

1. 在独立 Core 维护工作区合并官方上游，按 Core 自身规则处理 API、持久化、SDK 与测试变化；先确认必要补丁仍在，再形成明确提交。
2. 在该提交之后构建产物并执行 build check、发布包打包。不能拿提交前生成的客户端冒充新提交，也不能手改 commit-hash 记录让 pack 检查通过。
3. Desktop 子模块只 checkout 已提交、可取回的维护 Core SHA；同步来源 URL、pin 与借用文件的上游 SHA。Core pin 更新和桌面行为修改分开提交。
4. 通过实际 root scripts 构建子模块并同步 runtime 包，不从 npm 上同版本的未修复包回填。以下命令在 Desktop 仓库根运行：

```sh
corepack yarn upstream:prepare-runtime
node scripts/sync-vendored-runtime.mjs --write --channel next
corepack yarn install
```

5. 上述 `upstream:prepare-runtime` 准备的是 Core npm 发布包，不是 NEXT 的 Node/Python 解释器目录。当前 337 包是这次快照；未来新增包按发布策略核对，不为维持数字而删掉合法上游包。
6. 运行 `corepack yarn market:prepare` 与 `corepack yarn aa:prepare-release`，同步精确依赖、兼容补丁、产物、来源记录和锁文件。AA 必须来自当前官方 main，不能用旧缓存、离线回退或 `DSH_AA_SOURCE_REF=pinned` 冒充新构建。重建改变 bundle 布局时，按新包实际代码重定位补丁。
7. Core pin 变化后，先暂存 gitlink 再执行 `check:layout`；该门禁同时检查工作区和 index。不能因 index 还停在旧 SHA 就放宽 pin 检查。
8. 重新准备 NEXT 载荷与解释器再打包；旧的 `.desktop-build` 不是验收证据。根级 `package:dir:next` / `dist:win:next` 会执行各自的准备流程；生成目录不提交，精确版本、锁文件、vendor 和必要源变更一起提交。

## 5. 回归验收矩阵

| 检查 | 必须覆盖什么 |
| --- | --- |
| `corepack yarn install --immutable` | 当前 manifest、补丁和 lock 一致；不得让已删除补丁仍被 resolutions 引用。 |
| `corepack yarn check` | 来源与双语门禁、AA/Inspector/pnpm 兼容、Market/Fabric 检查、NEXT build/typecheck/unit、Host 与无窗口 runtime smoke。 |
| `verify:window-controls`、`verify:onboarding` | 官方前端 Desktop boot、Windows/通用 sidebar/settings、插件面板、原生 Browser 呈现与 Web iframe fallback；preload/IPC 是模拟的，不算原生 Electron 验收。 |
| `verify:safe-cleanup` | 真 Electron Node 模式中的六项 close/restart × readonly/external/ancestor 组合；外部与祖先目标的 sentinel 必须可写且保留。至少检查两个独立进程并发的私有目录隔离。 |
| `verify:protocol`、`verify:plugin-frames`、`verify:sidebar-browser` | 真 Windows x64 Electron 的认证、来源隔离、重定向、上传/下载、反 iframe、guest partition、历史和生命周期。Node launcher 拥有私有 home，只改子环境，等待进程退出后清理；CI 不默认关闭 sandbox。 |
| Windows 打包检查 | 锁定 Windows x64 Node/Python/pnpm/Office 资源、payload 摘要、PE/图标/NSIS/fuse 校验；不运行安装器覆盖开发者现用应用。 |
| 依赖审计 | 明确范围、实际退出码、漏洞与弃用提示及调用面防护；临时 staging workspace 不能自动算进 root 锁图的审计结论。 |

不支持的目标必须在删除旧 runtime 前失败；[prepare-runtime 回归](<../dsh-desktop-next/tests/prepare-runtime.spec.ts>) 覆盖了 Linux/macOS 请求不能清除已有载荷，以及 arm64/ia32 拒绝。不要把“无目标返回空数组”或“执行不了就 skip”恢复为成功路径。

本机原生窗口不能启动时，Node 模式的文件系统 smoke 和浏览器模拟仍不能证明原生 UI 可用。保留失败和未覆盖项，让真实 Windows CI 补验，不删断言、不改成 skip、不用现用应用或用户 Profile 充当测试夹具。会启用 AA 的 Host/浏览器 smoke 必须复用 [isolated-user-host](<../dsh-desktop-next/scripts/fixtures/isolated-user-host.mjs>) 在子进程内隔离 OS user home；仅设置 DSH_HOME 不足以隔离 AA 的共享身份目录。

## 6. 合并前清单

- [ ] Core SHA、包来源、借用文件记录、活动补丁和实际安装版本能对应起来；pi-ai 仍为经过验证的目标适配。
- [ ] NEXT 的 owned source、构建入口、资源和交付目标仍只有 Windows x64；Core 的其它平台源码没有被误裁。
- [ ] 未回导旧 Stable/Beta、0.87 兼容、闲置 CLI、未审的新默认组成或重复主前端。
- [ ] 所有新模块、配置、锁文件、生成产物和行为改动都进入针对性验证与独立增量核验；引用旧结果时快照仍匹配。
- [ ] 本指南、[NEXT 说明](<../dsh-desktop-next/README.zh.md>) 和双语 hash 记录随实际变化更新；历史设计文档不作为恢复旧代码的依据。
