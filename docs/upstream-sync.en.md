# Upstream synchronization guide

[中文](<upstream-sync.md>) · [Current NEXT package reference](<../dsh-desktop-next/README.md>)

This guide records the maintenance branch's necessary differences from upstream for future merges, upgrades and pruning. It is not a restoration list for historical Stable/Beta products: an old directory, patch or document is not evidence that it should be enabled again. Versions and package counts describe the current baseline, not permanent upgrade ceilings.

## 1. Establish ownership first

| Area | Current rule and authoritative records |
| --- | --- |
| Core | Preserve upstream's multiplatform source. Maintain and commit patches in a separate Core checkout, then advance the Desktop submodule; do not edit tracked submodule source from a Desktop feature branch. The current build pin is [fd55da1b3a](https://github.com/KouzakiUmi/deepseek-harness/commit/fd55da1b3a1a56d926a3697df8a6f8011ec49751) (the 0.2.1-rc.2 merge, local and not yet pushed); a documentation-fix commit [416800f4c6](https://github.com/KouzakiUmi/deepseek-harness/commit/416800f4c6) sits above it without changing runtime artifacts. The previous pushed baseline is [fcd4609c02](https://github.com/KouzakiUmi/deepseek-harness/commit/fcd4609c0289c1f38cb063959588143ca58a2926). |
| Desktop pin and package source | [upstream.json](<../upstream.json>), [submodule configuration](<../.gitmodules>) and the [runtime manifest](<../vendor/dsh-runtime/0.2.1-rc.2/manifest.json>) must identify the same maintenance Core commit. Equal package versions do not replace source commits and checksums. |
| NEXT | Windows x64 only. NEXT owns its windows, terminal, updates, permissions, packaging, interpreter payload and icons; do not restore other platform entry points. |
| Adopted implementation | [upstream-reference.json](<../dsh-desktop-next/upstream-reference.json>) records upstream files and their original SHA-256 values. It does not require locally adapted files to equal upstream. Merge file by file rather than overwriting Windows adaptations with a whole directory. |
| Package managers | Keep outer Yarn 4.18.0 separate from submodule pnpm. The outer [architecture configuration](<../.yarnrc.yml>) installs win32/x64 optional dependencies only. Do not slim the installation by deleting Core's other platform implementations. |
| AA / Market | Use their preparation scripts, source records and compatibility patches; neither justifies copying another Core or main frontend. |

NEXT consumes the pinned Core main frontend and its extension points, not a parallel main frontend. The current price-rendering fix belongs in the Core maintenance source, not a separate Desktop Markdown renderer.

## 2. Preserve these differences or replace them with evidence

| Difference | Behavior and review location |
| --- | --- |
| Minimal pi-ai 1.3.0 adaptation | The [Yarn patch](<../patches/pi-ai@1.3.0.patch>) removes seven lines of repeated partial-JSON parsing during delta events across six provider modules; text accumulation and completion-time parsing remain. Keep the Core pnpm patch semantically aligned. Do not restore the 0.87 branch or the broad 1.1-era compatibility overlay. Use `yarn why @earendil-works/pi-ai` to verify the actual selected version and patch. |
| Dollar prices and formulas | Preserve [Core currencyAwareMath](https://github.com/KouzakiUmi/deepseek-harness/blob/fd55da1b3a1a56d926a3697df8a6f8011ec49751/packages/client/ui-primitives/src/markdown/currencyAwareMath.ts), its parser integration, unit tests and real-message rendering checks together. Prices, CJK and `between $5 and $10 (see $x$)` must not be swallowed as formulas; `$x$`, `$2+2$`, valid padded formulas and display math must still work. Disabling math is not a fix. |
| ZIP call-site protection | Verify archive source and digest before extracting Windows Node, Python wheels and similar downloads; reject symlinks, devices and other special Unix file types in the entry callback. Unix mode bits are archive security metadata, not removable macOS/Linux product support. Keep negative tests using actual malicious ZIPs. |
| Directory-alias cleanup | [disposable-tree.ts](<../dsh-desktop-next/adopted/src/disposable-tree.ts>) does not trust `lstat().isSymbolicLink()` alone: native realpath compares an entry with its expected location under its canonical parent. Remove an alias entry without traversing its target. Ordinary realpath is not interchangeable with native realpath; use `path.relative` for Windows case comparison. |
| Update UX and exit handoff | [updates.ts](<../dsh-desktop-next/src/updates.ts>) keeps failures visible, retries failed cache initialization and avoids rescanning after success; notification deduplication does not authorize automatic installation. [installer.nsh](<../dsh-desktop-next/adopted/build/installer.nsh>) keeps visible installation and explicit restart. A per-machine update must wait for the old application before UAC handoff, not rely solely on the elevated inner check or restore silent `/S`. Call the `CHECK_APP_RUNNING` wrapper to initialize process paths rather than calling the custom check directly; declaration guards in the [builder patch](<../patches/app-builder-lib@26.15.7.patch>) allow the initialization phase and install Section to expand the check without unknown variables or duplicate declarations. |
| pnpm release-age compatibility | Rebase the [pnpm patch](<../patches/pnpm@11.28.5.patch>) against the actual current pnpm code rather than applying the old 11.8 build patch. Numeric and numeric-string zero behave consistently while positive ages remain enforced. The [compatibility tests](<../scripts/pnpm-release-age.test.mjs>) inspect installed code; do not disable age or trust policies to make them pass. Interpreter smokes run inside the bundled pnpm directory rather than inherit the outer Yarn project's cwd; package-manager checks remain enabled. |
| Inspector and Electron integration | Active patches are determined by [root resolutions](<../package.json>) and the installed graph, not every file in the patch directory. Rebase the Reload DevTools embedder callback after Inspector chunk renames and retain `test:inspector-compat`. Compare each remaining Windows/Electron patch with upstream fixes instead of overwriting or deleting them in bulk. |
| Electron builtin accessor | The [local native artifact record](<../vendor/node-addon-runtime/provenance.json>) and [exact-fingerprint patch](<../patches/node-addon-require-builtin@0.1.9-electron44.7.2.patch>) replace only the Win x64 platform package; entry/JS loader versions stay unchanged and no other platform package is added. The 44.7.2 Node/V8 tuple comes from the real runtime; retain machine-code decoding, pointer checks and rejection of unknown tuples, rather than widening a whitelist or guessing offsets. Verify ordinary Node, Electron Node mode and the real Electron main process separately; retire the local replacement after official support is actually verified. |
| ASAR application self-resolution | [Host self-resolution](<../dsh-desktop-next/src/host/own-package.ts>) maps only this application's declared file/default exports to package-local URLs; other packages retain the existing chain. Do not copy the application into a Profile or expose private subpaths. Ordinary Node finding a source checkout does not replace a real packaged Host check. |
| AA bridge | The [Connector patch](<../patches/agents-anywhere-connector-httpx.patch>) preserves bare IPv6 bypass for child httpx, parent environment isolation, Connector logging and content hashes consistent after JSON transport. [AA policy](<../scripts/agents-anywhere-release-policy.mjs>) owns all five runtime peers, including Cordis/Schemastery; do not hardcode a competing old peer range inside the patch. Current Gateway subscriptions and replies must share the same real Context-owned Peer; do not pass undefined, borrow the browser Peer or infer compatibility from function arity. |

| Reasoning-loop guard runtime | The guard implementation and its runtime files ship through the vendored runtime of the maintained Core commit, so version-bound patches over the runtime packages are retired. Do not restore the twelve-package candidate/root patches, their exporter or its verification entry point; advance the pin, manifest and lockfile together as in section 4. |

Prefer current same-major security fixes. Distinguish production, development, temporary AA staging and bundled client dependency graphs. The current delivery graph still contains extract-zip 2.0.1 advisories [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3): call-site protection does not remove an advisory. Do not exclude packages, ignore advisories or conflate deprecation notices with vulnerability counts.

Yarn 4.18.0 recursive audit can assert internally when a patch:file source descriptor is unbound; that does not mean there are no vulnerabilities. A diagnostic adapter must match that exact implementation and bind a missing file descriptor only to the unique registered resolution with the same ident and source path. Missing non-file descriptors or ambiguity must fail. Do not modify the global CLI, skip graph nodes or discard the full raw report. Retire temporary adaptation after an upstream fix rather than depending permanently on minified internals.

When a build host needs a proxy, reuse existing settings only for the build child. The current electron-builder 26.x download stack requires `ELECTRON_GET_USE_PROXY=true` and mapping existing proxies to `GLOBAL_AGENT_HTTP_PROXY` / `GLOBAL_AGENT_HTTPS_PROXY`; ordinary HTTP_PROXY alone does not mean that downloader has enabled proxying. Keep TLS certificate and archive digest checks enabled, and never commit machine-specific proxy addresses or credentials. Recheck these switches against the locked version after upgrading the downloader.

## 3. Do not import these back

- Do not restore the twelve-package guard patch set over the runtime packages, its candidate directory, exporter or verification command; the maintained Core commit carries the implementation, and a duplicate patch set only diverges from the artifacts.
- Do not restore macOS/Linux packaging, signing, notarization, universal/arm64 entry points, Darwin shell capture, macOS window-material/traffic-light handling, ICNS or tray-template icons. Keep Windows privacy entry points and native source selection.
- Do not restore Stable/Beta workspaces, variant synchronizers, old channel API ranges or links to removed packages. A broken link does not justify copying a retired product back.
- Do not mistake parameterized file filters, archive mode validation, platform-neutral third-party libraries or official Core platform implementations for unwanted platform code.
- Inspect JS/TS imports, CSS imports and build commands before removing tools. shadcn's only build consumer was a static stylesheet; its original CSS and full MIT permission are preserved as a [standalone asset](<../dsh-desktop-next/adopted/src/native-ui/shared/shadcn-tailwind.css>) with a [digest and license regression](<../dsh-desktop-next/tests/native-ui-asset.spec.ts>). Do not reintroduce the whole CLI and its unused old MCP SDK, ts-morph and fast-glob/micromatch/braces graph for this asset.
- SDK-required peer declarations are not feature activation. Keep Market peer/dev cohorts aligned with current Core; do not conceal missing providers with optional flags, ignored warnings or two Cordis installations.
- Do not add default plugins, old presets or a parallel frontend to bypass existing extension points. Evaluate new capabilities against actual product needs.

## 4. Safe synchronization order

1. Merge official upstream in the separate maintained Core checkout, following Core's API, persistence, SDK and testing rules. Confirm required adaptations remain before creating an explicit commit.
2. Build artifacts, run build check and pack from that commit. Do not label pre-commit client artifacts as the new commit or edit commit-hash records to bypass packing checks.
3. Desktop only checks out an already committed, retrievable maintenance Core SHA. Update source URLs, pins and upstream hashes for adopted files. Keep Core pin updates separate from Desktop behavior commits.
4. Use actual root scripts to rebuild submodule packages and synchronize the runtime; do not substitute unpatched npm packages merely because their versions match. Run these from the Desktop repository root:

```sh
corepack yarn upstream:prepare-runtime
node scripts/sync-vendored-runtime.mjs --write --channel next
corepack yarn install
```

5. `upstream:prepare-runtime` prepares Core npm archives, not NEXT's Node/Python interpreter directory. The current 337 packages are a snapshot: review future additions under release policy rather than deleting legitimate packages to preserve a count.
6. Run `corepack yarn market:prepare` and `corepack yarn aa:prepare-release`; synchronize exact dependencies, compatibility patches, archives, source records and the lockfile. AA must come from current official main, not old cached output, offline fallback or `DSH_AA_SOURCE_REF=pinned`. Rebase patches against actual new package code when rebuilding changes bundle layout.
7. Stage the gitlink before `check:layout` after advancing Core. That gate checks both working tree and index; do not weaken pin validation because the index still holds the old SHA.
8. Prepare fresh NEXT payload and interpreters before packaging; an old `.desktop-build` is not acceptance evidence. Root `package:dir:next` / `dist:win:next` perform their preparation steps. Do not commit generated build directories; commit exact versions, lockfile, vendor output and required source changes together.

9. An Electron upgrade must also check the native builtin accessor. Pin the official source commit and apply the recorded patch, then use existing MSVC and public Node headers to build only `require-builtin` / `napi-v9` / `win32-x64-msvc`. Actually run `backend.test.js` under ordinary Node and real Electron Node mode, plus exact-fingerprint positive/negative cases; verify the main process separately with `verify:native-builtins`. Stage only that platform package, set an explicit Desktop prerelease version, replace `workspace:*` with the loader version in use and retain MIT licensing before packing the single package; do not run full-matrix publication scripts. Synchronize the archive, source patch, source/binary digests, root resolution and lockfile together, rather than replace a node_modules binary in place.

## 5. Regression matrix

| Check | Required coverage |
| --- | --- |
| `corepack yarn install --immutable` | Current manifests, patches and lock agree; resolutions must not reference deleted patches. |
| `corepack yarn check` | Source and bilingual gates, AA/Inspector/pnpm compatibility, Market/Fabric checks, NEXT build/typecheck/unit tests, Host and non-graphical runtime smokes. |
| `verify:window-controls`, `verify:onboarding` | Official Desktop frontend boot, Windows/common sidebar/settings, plugin panels, native Browser presentation and Web iframe fallback. Preload/IPC is simulated; this is not native Electron acceptance. |
| `verify:safe-cleanup` | Six real Electron Node-mode close/restart × readonly/external/ancestor cases; external and ancestor sentinels must be writable and survive. Also check private-directory isolation across two independent concurrent processes. |
| `verify:protocol`, `verify:plugin-frames`, `verify:sidebar-browser` | Real Windows x64 Electron authentication, origin isolation, redirects, uploads/downloads, anti-iframe behavior, guest partitions, history and lifetime. The Node launcher owns the private home, changes only child environment and cleans up after process exit; CI does not disable the sandbox by default. |
| Windows package validation | `check:win-package` must build the runtime community adapter before the NEXT gate; do not depend on another CI job or old lib output. Locked Windows x64 Node/Python/pnpm/Office resources, payload digests, PE/icon/NSIS/fuse checks. Do not run an installer over the developer's active application. |
| Dependency audit | Explicit scope, real exit code, vulnerabilities versus deprecations and call-site safeguards. Root lock-graph results do not automatically cover a temporary staging workspace. |

Unsupported targets must fail before removing an existing runtime. [prepare-runtime regressions](<../dsh-desktop-next/tests/prepare-runtime.spec.ts>) cover Linux/macOS requests preserving old payloads and rejection of arm64/ia32. Do not restore empty target arrays or execution skips as successful unsupported-target paths.

When native windows cannot start on a machine, Node-mode filesystem smokes and browser simulations still do not establish native UI behavior. Preserve the failure and coverage gap for actual Windows CI; do not remove assertions, introduce skips or use the active application/user Profile as a fixture. Host/browser smokes that enable AA must reuse [isolated-user-host](<../dsh-desktop-next/scripts/fixtures/isolated-user-host.mjs>) to isolate the OS user home inside the child; DSH_HOME alone does not isolate AA's shared identity directory.

## 6. Pre-merge checklist

- [ ] Core SHA, archive sources, adopted-file records, active patches and installed versions agree; pi-ai retains the verified target adaptation.
- [ ] NEXT owned source, build entry points, resources and delivery targets remain Windows x64 only; Core's other platform source is intact.
- [ ] No old Stable/Beta product, 0.87 adaptation, unused CLI, unreviewed default composition or duplicate main frontend was restored.
- [ ] New modules, configuration, lockfiles, generated artifacts and behavior changes receive targeted checks and independent incremental review; reused evidence still matches its snapshot.
- [ ] Update this guide, the [NEXT reference](<../dsh-desktop-next/README.md>) and bilingual hash records with actual changes; historical design documents are not instructions to restore retired code.
