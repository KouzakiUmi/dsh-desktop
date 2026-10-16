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

## Implementation ownership

The guard's Core source implementation and its runtime files are part of the maintained Core commit, and Desktop takes them from the vendored runtime pinned by `upstream.json`, so version-bound patches over the runtime packages are no longer needed. Upgrade Core through the [upstream synchronization guide](upstream-sync.md) by moving the pin, the vendored manifest, and the lockfile together. Do not reintroduce candidate patches or the exporter, and do not replace files inside an installed tree by hand.

The former twelve-package patch set (candidate directory, root active patches, exporter, its verification command, and its tests) is removed with this migration: those patches described turning the alpha.3 runtime packages into the version that already contains the implementation, so their pre-change state no longer exists in the current Core artifacts. Provenance stays gated — `check:vendored-runtime` verifies archive digests and resolutions, the [borrowed-file record](../dsh-desktop-next/upstream-reference.json) records each borrowed file's upstream SHA-256, and the local NEXT `build` and `dist:win` entry points no longer run a patch check.

## Acceptance and status

Acceptance covers normal long reasoning, newline-free/short-phrase loops, changed identifiers and negations, chunk-size invariance, short repetition followed by successful tools, sustained-loop termination, full-block reinjection, signature rejection, cleanup failures, ordinary always-retry isolation, and native-child cancellation without resurrection. Visible behavior requires real Loader composition and keyless session snapshots. Local fake-wire projection checks do not constitute real-model validation.

Core source implementation and targeted validation are complete, including suppression, recovery, native children, session readers, and keyless snapshots through the real Loader and SDK. This round follows the acceptance corrections: the visible stall now applies a per-character hard ceiling (`maxWindowChars`, deciding from current evidence at the ceiling whether to interrupt or release), requires recurring sentences to carry real character mass (`unitCharShare`, so a recurring interjection cannot qualify an observation by itself), and suspends detection inside fenced code. Its measured limit is recorded with it: 7 of the 106 reasoning blocks longer than 2,000 characters in the recorded session behind it crossed the thresholds, and one of those kept repeating for roughly 4,000 further characters before recovering on its own. The twelve packages ship through the vendored runtime of the maintained Core commit, and all 41 runtime files are final in those artifacts; the candidate patches, root active patches, and exporter are removed with them. This round adds the Chat client bundle and every consumer of the new live detection stage: the loop publishes the policy failure before provider cleanup, the guard reports its real withholding transitions (suspected, released, barrier) once per episode without entering model output, the Chat row retains the delivered prefix, reports the recovery ordinal and Turn limit, and never presents a continued Step as stopped, and the Host bridge restores the live attempt's current stage on reconnect. The guard still requires explicit configuration; user Profiles and the running application remain unchanged. Actual large-context DS behavior, threshold accuracy, and the enabled guard's packaged behavior still require independent validation and cannot be inferred from static inspection or synthetic samples.
