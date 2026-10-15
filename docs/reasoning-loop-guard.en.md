# CoT loop-guard integration

[中文](reasoning-loop-guard.md)

## Goal and delivery scope

Suppress large repeated reasoning before it enters the session record, retaining the earliest verbatim representative and material not established as duplicate. Ordinary reasoning passes immediately; only suspected repetition is buffered. Suppression and cancellation have separate thresholds so brief repetition may recover or produce a normal tool call. Some repetition may commit before detection; committed history is not rolled back and zero pollution from semantic loops is not promised.

Core owns prepared-call capabilities, commit gating, and call-scoped cancellation/recovery. Detection is an explicit optional configuration of the existing repeat-tool-reminder plugin; its original tool-reminder default remains unchanged. This integration does not modify the installed application or user Profiles. Source validation and activation in a packaged NEXT release are separate stages.

## Capabilities and context

- Editing requires an adapter guarantee that the same prepared-call generation can safely reconstruct the edited response. Unknown and opaque-signature routes remain conservative; a model name or the absence of a signature so far is not evidence.
- DS Messages retains native signed reasoning and does not advertise editing. The pi-ai `reasoningReplay: plain` mode is explicit, not a global default, and must reject signatures or replay data it cannot safely interpret.
- In plain mode, a safe reasoning-only prefix with no text or tools may enter the next wire request as verbatim assistant text so upstream conversion does not skip it. Normal reasoning with tools keeps its native field representation. This representation change does not invent reasoning content.
- The existing `interrupted` marker represents a safe prefix retained after stream interruption; a loop-policy interruption is neither user cancellation nor natural completion. Core owns this documented persistence-semantics extension and SDK/UI reader checks. Existing history is not rewritten.

## Commit and tool constraints

Filtered content must be the shared source of stream records, assembled blocks, and live notifications. A later `block-end` must not restore suppressed copies. No second large raw-repetition log is retained to preserve signatures. The pending buffer, detection window, and metadata have aggregate limits; Core gating does not bound the upstream SDK's own response storage.

Text promising tools, partial tool headers, or parseable JSON do not establish an executable call. A complete tool block receives a bounded opportunity to settle: `settlementBudget` charges subsequent events plus new delta UTF-16 characters, so continuous output cannot bypass the idle timeout indefinitely. Exhaustion fails with `TOOL_SETTLEMENT_LIMIT`, dispatches no tools from that call, and does not recover automatically. Normal execution still requires the existing successful terminal result, validation, and authorization. Do not fabricate a finish, complete partial tools, or flush confirmed duplicates when text/tools arrive.

Only a locally initiated interruption with successful cleanup and no user/parent/disposal cancellation may recover within its budget. A producer-labelled continuation prompt is durably recorded, and the same native child activation recovers before final settlement rather than racing a global idle listener. External Codex, ACP, and Claude Code executions are not automatically covered by the parent's filter; a DSH SDK child process needs an internal integration.

## Version-bound patches

The [patch exporter](../dsh-desktop-next/scripts/reasoning-loop-patches.mjs) compares built publishable runtime files from the independent Core checkout against exact archives in the current [vendored manifest](../vendor/dsh-runtime/0.2.1-alpha.3/manifest.json). It checks versions, the baseline commit, archive hashes, and per-file reconstruction, then emits input/output SHA-256 records without changing dependencies, lockfiles, Profiles, or sealed payloads. Missing build files are not converted into deletions, and existing output is never overwritten.

Run in the NEXT workspace with actual paths chosen for this export:

```sh
node scripts/reasoning-loop-patches.mjs --core-root <built-independent-Core-checkout> --output <new-patch-output-directory>
```

Exported patches are candidates, not activated runtime changes. After reviewing them, use the root resolutions' versioned `patch:file` mechanism and corresponding lockfile during dependency preparation, then copy and seal the [prepared payload](../dsh-desktop-next/scripts/prepare-payload.ts). Never alter bytes after `sealPayload` or treat an unresolved old node_modules tree as the activated result. Do not edit Desktop's pinned submodule or misstate its upstream source SHA.

## Automated build integration

The local NEXT `build` and `dist:win` entry points run the following patch verification before compilation or packaging; `package:dir` inherits it through `build`. Root build/packaging commands ultimately enter these workspace scripts, so detecting missing patches does not depend on remote CI.

```sh
corepack yarn workspace dsh-desktop-next verify:reasoning-loop
```

Verification checks seven package versions, 14 resolutions, candidate-to-active patch correspondence, installed published-file SHA-256 hashes, and exporter/Git applicability behavior. Builds do not regenerate patches from a local Core checkout. Their inputs are the versioned patches, inventory, vendored archives, and lockfile in this repository. A Core upgrade requires reviewing and updating the cohort together rather than bypassing a failing check.

Commit those inputs with the verification tests and exporter; uploading only the archive does not integrate it into builds. Existing CI builds the Windows installer without publishing it. Shipping guard support does not enable it by default: `reasoningLoop` and the adapter's plain mode remain explicit choices, and user Profiles are not rewritten automatically.

## Acceptance and status

Acceptance covers normal long reasoning, newline-free/short-phrase loops, changed identifiers and negations, chunk-size invariance, short repetition followed by successful tools, sustained-loop termination, full-block reinjection, signature rejection, cleanup failures, ordinary always-retry isolation, and native-child cancellation without resurrection. Visible behavior requires real Loader composition and keyless session snapshots. Local fake-wire projection checks do not constitute real-model validation.

Core source implementation and targeted validation are complete, including suppression, recovery, native children, session readers, and keyless snapshots through the real Loader and SDK. The NEXT exporter passes isolated tests and type checks; all seven candidate package patches pass exact archive fingerprint checks and independent Git applicability checks, recorded in the [patch inventory](../patches/reasoning-loop/0.2.1-alpha.3/reasoning-loop-patches.json). The seven patches are now promoted to root `patches/<package>@<version>.patch` and installed into the local dependency tree through 14 exact/range version selectors using Yarn `patch:file` resolutions and the lockfile; all 21 runtime files match the recorded output hashes. The original candidate archives remain unchanged. Active patches only remove the extra blank separator between file diffs for Yarn's strict hunk checks; the exporter and regression tests have the same correction. The guard still requires explicit configuration; user Profiles and the running application remain unchanged. Actual large-context DS behavior, threshold accuracy, and the enabled guard's packaged behavior still require independent validation and cannot be inferred from static inspection or synthetic samples.
