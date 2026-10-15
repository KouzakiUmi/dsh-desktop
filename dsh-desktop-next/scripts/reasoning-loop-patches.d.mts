/** Version-bound patch artifacts exported without changing the installed dependency graph. */
export interface RuntimeFileChange {
  path: string
  beforeSha256: string | null
  afterSha256: string
}

/** A Git-format patch and the exact file identities it reconstructs. */
export interface RuntimePatch {
  patch: string
  files: RuntimeFileChange[]
}

/** One package's patch against its verified baseline archive. */
export interface PackageRuntimePatch extends RuntimePatch {
  filename: string
  package: string
  archive: string
  archiveSha256: string
}

/** Candidate artifacts; exporting these does not activate them in NEXT. */
export interface ReasoningPatchSet {
  baseline: { commit: string; version: string }
  outputs: PackageRuntimePatch[]
}

/** Packages whose compiled output implements the reasoning-loop capability. */
export const REASONING_PACKAGES: readonly string[]

/** Read ordinary npm archive files in memory without extraction. */
export function readPackageArchive(file: string): Promise<Map<string, Buffer>>

/** Produce a patch after checking exact reconstruction of every changed file. */
export function runtimePatch(before: ReadonlyMap<string, Buffer>, after: ReadonlyMap<string, Buffer>): RuntimePatch

/** Collect changed publishable runtime files against verified baseline archives. */
export function collectReasoningPatches(options: {
  coreRoot: string
  desktopRoot: string
  packages?: readonly string[]
}): Promise<ReasoningPatchSet>

/** Write new artifacts, refusing existing output paths. */
export function writeReasoningPatches(output: string, result: ReasoningPatchSet): void
