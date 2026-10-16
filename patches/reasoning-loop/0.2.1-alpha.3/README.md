# CoT loop-guard runtime patch set

These are reviewable, unapplied runtime patches for `@deepseek-ai/dsh-*` version `0.2.1-alpha.3`, based on vendored Core commit `f43a201de78c2926820a6670bbb8b653a39b0308`.

## Contents

Twelve package patches cover LLM capabilities and canonical blocks, Agent policy types, Agent Loop call-scoped interruption/recovery with its pre-cleanup failure publication and live detection stages, Session prefix semantics, the opt-in repeat-tool-reminder reasoning policy with its visible-output stall, withholding stages, and recorded recovery Step/ordinal/limit, native DeepSeek opaque capability, explicit pi-ai plain mode, the Chat client bundle that presents detection stages, the retained prefix, and the recovery notice, the Host Session bridge and its wire baseline, the Trajectory and Inspector client bundles that consume the live rows, and the Headless terminal bundle. `reasoning-loop-patches.json` records each input archive, patch, and changed output file's SHA-256; 41 compiled runtime files carry a patch, including the added `lib/types/visible-stall.d.ts` and `lib/types/client/chat/RecoveryNotice.d.ts`. Candidates and the active root patches are byte-identical: the exporter emits no separator line between file diffs.

Tests, SDK fixtures, persistence acknowledgements, ADRs, and the narrow Windows snapshot support fixes remain in the independent Core source checkout; they are not production runtime patches. This bundle does not modify the pinned Desktop submodule, claim an uncommitted change as an upstream commit, or change Session format version 4.

## Verified

- Patch exporter isolated tests and NEXT type checking.
- All twelve archive/patch/output fingerprints checked against the frozen built Core files.
- Every patch checked by `git apply --check` against an isolated copy of its exact baseline package archive.
- Targeted source-level reasoning, interruption/recovery, tools, and native-child tests.
- Real Loader headless and SDK keyless replay, with notifications and final-result goldens present.

This is not a real-model or packaged-runtime validation. Defaults are conservative opt-ins, not evidence of universal model support. Native DS Messages signatures remain opaque; supported Chat Completions plain mode must be selected explicitly. Existing user Profiles are unchanged.

## Integration boundary

This candidate directory is deliberately separate from the active root `patches/<package>@<version>.patch` lookup. It is not loaded by the running application or current dependency tree.

After reviewing and promoting the candidates, the root resolutions must use the exact existing vendored archives through the versioned Yarn `patch:file` mechanism and the lockfile must be resolved consistently. Apply patches during dependency preparation, before copying and sealing the payload. Never alter a sealed payload, replace installed files manually, or treat an unchanged node_modules tree as patched.

Runtime opt-in configuration and supported-route requirements are documented in the Core repeat-tool-reminder and llm-pi-ai READMEs. Desktop integration status and the exporter are documented in [the integration guide](../../../docs/reasoning-loop-guard.md).
