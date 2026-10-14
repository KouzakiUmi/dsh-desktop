// SlotMap convergence for the Desktop client program. Core 0.2.1-alpha.3's
// ui-workspace `contract/slots` references the `workspace.toast` render slot,
// but the SlotMap augmentation that declares it ships in `contract/toast`,
// which no reachable import pulls into a consumer program (the package export
// map exposes only the client entry, and that entry re-exports `contract/slots`
// without `contract/toast`). Upstream's own typecheck sets skipLibCheck, so the
// published declarations carry this gap unnoticed; the Desktop packages check
// library types strictly and therefore need the slot axes declared where the
// client program can see them. The axes below match the shipped declaration
// (`kind: 'keyed'`, `scope: 'root'`); only the owner/keyProps shares are
// omitted because nothing in the Desktop client consumes them.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'workspace.toast': {
      kind: 'keyed'
      scope: 'root'
    }
  }
}

export {}
