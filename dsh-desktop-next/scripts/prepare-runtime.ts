/** Prepare, execute and check the bundled Windows x64 interpreter payload one Next package carries. */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { preparePrimaryRuntime, readPrimaryRuntimeLock, smokePrimaryRuntime, type PrimaryRuntimeTarget } from './primary-runtime.ts'

/** CPU of one bundled payload. Next ships Windows x64 only. */
export type NextRuntimeArch = 'x64'

/** One payload the package carries. */
export interface NextRuntimeTarget {
  readonly target: PrimaryRuntimeTarget
  readonly arch: NextRuntimeArch
}

/**
 * Select the Windows x64 interpreter payload; reject unsupported targets before filesystem changes.
 * @param platform - Electron platform being packaged.
 * @param arch - Host CPU, which must be x64.
 * @returns The locked Windows x64 target.
 */
export function nextRuntimeTargets(platform: NodeJS.Platform, arch: NodeJS.Architecture = process.arch): readonly NextRuntimeTarget[] {
  if (platform !== 'win32' || arch !== 'x64') throw new Error(`Next runtime requires Windows x64, received ${platform} ${arch}`)
  return [{ target: 'win-x64', arch: 'x64' }]
}

/**
 * Build-owned directories under the Next package: the prepared runtime tree that `extraResources`
 * copies verbatim, and the SHA-256-addressed download cache shared by every build.
 * @param desktopRoot - Next package root.
 * @returns Runtime root and download cache.
 */
export function nextRuntimeBuildPaths(desktopRoot: string): { readonly runtime: string; readonly downloads: string } {
  return { runtime: join(desktopRoot, '.desktop-build', 'runtime'), downloads: join(desktopRoot, '.desktop-build', 'downloads') }
}

/**
 * Payload directory of one CPU: `<root>/<arch>/primary-runtime`, with `office-skills` beside it as
 * upstream Desktop lays out `Resources/runtime`.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute payload directory.
 */
export function primaryRuntimeDirectory(runtimeRoot: string, arch: NextRuntimeArch): string {
  return join(runtimeRoot, arch, 'primary-runtime')
}

/**
 * Office skill resources of one CPU's payload.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute resource directory.
 */
export function officeSkillsDirectory(runtimeRoot: string, arch: NextRuntimeArch): string {
  return join(runtimeRoot, arch, 'office-skills')
}

/**
 * Version every payload must declare: the drill override, otherwise the source manifest.
 * @param desktopRoot - Next package root.
 * @param env - Packaging environment.
 * @returns Product version.
 */
export function expectedNextVersion(desktopRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const source = (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }).version
  return env.DSH_NEXT_BUILD_VERSION ?? source
}

/** Inputs of one preparation. */
export interface PrepareNextRuntimeOptions {
  readonly desktopRoot: string
  readonly platform: NodeJS.Platform
  readonly version: string
  readonly log?: (message: string) => void
}

/**
 * Materialize every payload of the platform from the upstream lock, replacing the previous tree.
 * First use downloads the locked archives; later runs reuse the cache.
 * @param options - Package root, platform and product version.
 * @returns The prepared Windows x64 runtime root.
 */
export async function prepareNextRuntime(options: PrepareNextRuntimeOptions): Promise<string> {
  const targets = nextRuntimeTargets(options.platform)
  const paths = nextRuntimeBuildPaths(options.desktopRoot)
  const log = options.log ?? console.log
  rmSync(paths.runtime, { recursive: true, force: true })
  const lock = readPrimaryRuntimeLock()
  const skillSource = join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
  for (const { target, arch } of targets) {
    log(`Preparing the ${target} primary runtime (Python ${lock.pythonVersion}, Node ${lock.nodeVersion}) for ${options.version}`)
    await preparePrimaryRuntime({ lock, target, output: join(paths.runtime, arch), cache: paths.downloads, version: options.version, skillSource })
  }
  return paths.runtime
}

/**
 * Execute the Windows x64 payload; an incompatible host or payload is an error.
 * @param runtimeRoot - Prepared runtime root.
 * @param platform - Platform the payload targets.
 * @param log - Progress output.
 * @returns CPUs whose payload ran.
 */
export function smokeNextRuntime(runtimeRoot: string, platform: NodeJS.Platform, log: (message: string) => void = console.log): NextRuntimeArch[] {
  const executed: NextRuntimeArch[] = []
  for (const { arch } of nextRuntimeTargets(platform)) {
    const root = primaryRuntimeDirectory(runtimeRoot, arch)
    if (!smokePrimaryRuntime(root)) throw new Error(`Next runtime ${arch} cannot execute on ${process.platform} ${process.arch}`)
    executed.push(arch)
    log(`Primary runtime smoke passed for ${arch}`)
  }
  return executed
}

/** One verified payload. */
export interface VerifiedNextRuntime {
  readonly arch: NextRuntimeArch
  readonly directory: string
  readonly manifest: PrimaryRuntimeManifest
}

function requireFile(path: string, description: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Next runtime: missing ${description}: ${path}`)
}

/**
 * Check a prepared or packaged runtime root: the payload declares the Windows x64 target and this
 * version with Node and pnpm, and its entry points and Office resources exist.
 * @param runtimeRoot - `.desktop-build/runtime` or the packaged `Resources/runtime`.
 * @param platform - Platform the package targets.
 * @param expectedVersion - Product version every manifest must record.
 * @returns The verified payloads in target order.
 */
export function verifyNextRuntimeTree(runtimeRoot: string, platform: NodeJS.Platform, expectedVersion: string): VerifiedNextRuntime[] {
  const verified: VerifiedNextRuntime[] = []
  for (const { arch } of nextRuntimeTargets(platform)) {
    const directory = primaryRuntimeDirectory(runtimeRoot, arch)
    const manifestFile = join(directory, 'runtime.json')
    requireFile(manifestFile, `${arch} payload manifest`)
    const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestFile, 'utf8')))
    if (manifest.platform !== platform || manifest.arch !== arch) throw new Error(`Next runtime: ${directory} declares ${manifest.platform} ${manifest.arch}, expected ${platform} ${arch}`)
    if (manifest.desktopVersion !== expectedVersion) throw new Error(`Next runtime: ${directory} declares version ${manifest.desktopVersion}, expected ${expectedVersion}`)
    if (manifest.node === undefined || manifest.pnpm === undefined) throw new Error(`Next runtime: ${directory} must bundle Node and pnpm`)
    const entries = workspaceDependencyPaths(directory, manifest)
    if (entries.node === undefined || entries.pnpm === undefined) throw new Error(`Next runtime: ${directory} resolves no Node or pnpm entry`)
    requireFile(entries.python, `${arch} Python interpreter`)
    requireFile(entries.node, `${arch} Node executable`)
    requireFile(entries.pnpm, `${arch} pnpm entry`)
    if (!existsSync(entries.pythonPackages) || !statSync(entries.pythonPackages).isDirectory()) throw new Error(`Next runtime: missing ${arch} site-packages: ${entries.pythonPackages}`)
    const skills = officeSkillsDirectory(runtimeRoot, arch)
    for (const skill of ['office', 'office-docx', 'office-export-pdf', 'office-pptx', 'office-recalculate', 'office-render', 'office-xlsx']) {
      requireFile(join(skills, skill, 'SKILL.md'), `${arch} ${skill} skill`)
    }
    verified.push({ arch, directory, manifest })
  }
  return verified
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const desktopRoot = resolve(import.meta.dirname, '..')
  const version = expectedNextVersion(desktopRoot)
  const root = await prepareNextRuntime({ desktopRoot, platform: process.platform, version })
  verifyNextRuntimeTree(root, process.platform, version)
  smokeNextRuntime(root, process.platform)
}
