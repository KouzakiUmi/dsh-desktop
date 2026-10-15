/** Prepare, execute and check the bundled Windows x64 interpreter payload one Desktop package carries; ported from upstream Desktop. */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { preparePrimaryRuntime, readPrimaryRuntimeLock, smokePrimaryRuntime, type PrimaryRuntimeTarget } from './primary-runtime.ts'

/** CPU of one bundled payload. Desktop ships Windows x64 only. */
export type DesktopRuntimeArch = 'x64'

/** One payload the package carries. */
export interface DesktopRuntimeTarget {
  readonly target: PrimaryRuntimeTarget
  readonly arch: DesktopRuntimeArch
}

/**
 * Payload one Desktop package carries: the Windows x64 interpreters only. Every other platform
 * returns an empty list, and the Windows packaging entry point refuses them before this is reached.
 * @param platform - Electron platform being packaged.
 * @returns Locked target and its CPU, or nothing for a platform the product does not ship.
 */
export function desktopRuntimeTargets(platform: NodeJS.Platform): readonly DesktopRuntimeTarget[] {
  return platform === 'win32' ? [{ target: 'win-x64', arch: 'x64' }] : []
}

/**
 * Build-owned directories under the Desktop package: the prepared runtime tree that `extraResources`
 * copies verbatim, and the SHA-256-addressed download cache shared by every build.
 * @param desktopRoot - Desktop package root.
 * @returns Runtime root and download cache.
 */
export function desktopRuntimeBuildPaths(desktopRoot: string): { readonly runtime: string; readonly downloads: string } {
  return { runtime: join(desktopRoot, '.desktop-build', 'runtime'), downloads: join(desktopRoot, '.desktop-build', 'downloads') }
}

/**
 * Payload directory of the CPU: `<root>/x64/primary-runtime`, with `office-skills` beside it as
 * upstream Desktop lays out `Resources/runtime`.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute payload directory.
 */
export function primaryRuntimeDirectory(runtimeRoot: string, arch: DesktopRuntimeArch): string {
  return join(runtimeRoot, arch, 'primary-runtime')
}

/**
 * Office skill resources of the payload.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute resource directory.
 */
export function officeSkillsDirectory(runtimeRoot: string, arch: DesktopRuntimeArch): string {
  return join(runtimeRoot, arch, 'office-skills')
}

/**
 * Version every payload must declare: the product version of the package manifest.
 * @param desktopRoot - Desktop package root.
 * @returns Product version.
 */
export function expectedDesktopVersion(desktopRoot: string): string {
  return (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }).version
}

/** Inputs of one preparation. */
export interface PrepareDesktopRuntimeOptions {
  readonly desktopRoot: string
  readonly platform: NodeJS.Platform
  readonly version: string
  readonly log?: (message: string) => void
}

/**
 * Materialize the payload of the platform from the upstream lock, replacing the previous tree.
 * First use downloads the locked archives; later runs reuse the cache.
 * @param options - Package root, platform and product version.
 * @returns The runtime root, empty for platforms without a payload.
 */
export async function prepareDesktopRuntime(options: PrepareDesktopRuntimeOptions): Promise<string> {
  const paths = desktopRuntimeBuildPaths(options.desktopRoot)
  const log = options.log ?? console.log
  rmSync(paths.runtime, { recursive: true, force: true })
  const targets = desktopRuntimeTargets(options.platform)
  if (targets.length === 0) {
    log(`Desktop ships no interpreter payload for ${options.platform}`)
    return paths.runtime
  }
  const lock = readPrimaryRuntimeLock()
  const skillSource = join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
  for (const { target, arch } of targets) {
    log(`Preparing the ${target} primary runtime (Python ${lock.pythonVersion}, Node ${lock.nodeVersion}) for ${options.version}`)
    await preparePrimaryRuntime({ lock, target, output: join(paths.runtime, arch), cache: paths.downloads, version: options.version, skillSource })
  }
  return paths.runtime
}

/**
 * Execute the payload when this host can run it; a foreign host reports the skip instead.
 * @param runtimeRoot - Prepared runtime root.
 * @param platform - Platform the payload targets.
 * @param log - Progress output.
 * @returns CPUs whose payload ran.
 */
export function smokeDesktopRuntime(runtimeRoot: string, platform: NodeJS.Platform, log: (message: string) => void = console.log): DesktopRuntimeArch[] {
  const executed: DesktopRuntimeArch[] = []
  for (const { arch } of desktopRuntimeTargets(platform)) {
    const root = primaryRuntimeDirectory(runtimeRoot, arch)
    if (smokePrimaryRuntime(root)) {
      executed.push(arch)
      log(`Primary runtime smoke passed for ${arch}`)
    } else log(`Primary runtime smoke skipped for ${arch}: this ${process.platform} ${process.arch} host cannot execute it`)
  }
  return executed
}

/** One verified payload. */
export interface VerifiedDesktopRuntime {
  readonly arch: DesktopRuntimeArch
  readonly directory: string
  readonly manifest: PrimaryRuntimeManifest
}

function requireFile(path: string, description: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Desktop runtime: missing ${description}: ${path}`)
}

/**
 * Check a prepared or packaged runtime root: the payload declares the Windows x64 target and this
 * version with Node and pnpm, and its entry points and Office resources exist.
 * @param runtimeRoot - `.desktop-build/runtime` or the packaged `Resources/runtime`.
 * @param platform - Platform the package targets.
 * @param expectedVersion - Product version every manifest must record.
 * @returns The verified payloads in target order.
 */
export function verifyDesktopRuntimeTree(runtimeRoot: string, platform: NodeJS.Platform, expectedVersion: string): VerifiedDesktopRuntime[] {
  const verified: VerifiedDesktopRuntime[] = []
  for (const { arch } of desktopRuntimeTargets(platform)) {
    const directory = primaryRuntimeDirectory(runtimeRoot, arch)
    const manifestFile = join(directory, 'runtime.json')
    requireFile(manifestFile, `${arch} payload manifest`)
    const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestFile, 'utf8')))
    if (manifest.platform !== platform || manifest.arch !== arch) throw new Error(`Desktop runtime: ${directory} declares ${manifest.platform} ${manifest.arch}, expected ${platform} ${arch}`)
    if (manifest.desktopVersion !== expectedVersion) throw new Error(`Desktop runtime: ${directory} declares version ${manifest.desktopVersion}, expected ${expectedVersion}`)
    if (manifest.node === undefined || manifest.pnpm === undefined) throw new Error(`Desktop runtime: ${directory} must bundle Node and pnpm`)
    const entries = workspaceDependencyPaths(directory, manifest)
    if (entries.node === undefined || entries.pnpm === undefined) throw new Error(`Desktop runtime: ${directory} resolves no Node or pnpm entry`)
    requireFile(entries.python, `${arch} Python interpreter`)
    requireFile(entries.node, `${arch} Node executable`)
    requireFile(entries.pnpm, `${arch} pnpm entry`)
    if (!existsSync(entries.pythonPackages) || !statSync(entries.pythonPackages).isDirectory()) throw new Error(`Desktop runtime: missing ${arch} site-packages: ${entries.pythonPackages}`)
    const skills = officeSkillsDirectory(runtimeRoot, arch)
    for (const skill of ['office', 'office-docx', 'office-export-pdf', 'office-pptx', 'office-recalculate', 'office-render', 'office-xlsx']) {
      requireFile(join(skills, skill, 'SKILL.md'), `${arch} ${skill} skill`)
    }
    verified.push({ arch, directory, manifest })
  }
  return verified
}

/** Inputs of one complete preparation. */
export interface PrepareDesktopInterpretersOptions {
  readonly desktopRoot: string
  /** Platform the payloads target; defaults to this host. */
  readonly platform?: NodeJS.Platform
  readonly log?: (message: string) => void
}

/**
 * Prepare the interpreter payload the platform ships, then check and execute the final bytes.
 * Development launches and every packaging entry run this first; electron-builder later copies the
 * tree as extra resources.
 * @param options - Package root and target platform.
 * @returns The prepared runtime root.
 */
export async function prepareDesktopInterpreters(options: PrepareDesktopInterpretersOptions): Promise<string> {
  const platform = options.platform ?? process.platform
  const version = expectedDesktopVersion(options.desktopRoot)
  const root = await prepareDesktopRuntime({ desktopRoot: options.desktopRoot, platform, version, ...(options.log === undefined ? {} : { log: options.log }) })
  verifyDesktopRuntimeTree(root, platform, version)
  smokeDesktopRuntime(root, platform, options.log)
  return root
}

/**
 * Re-check the prepared tree right before electron-builder copies it; the payload was prepared
 * before the package gates started.
 * @param desktopRoot - Desktop package root.
 * @param platform - Platform the package targets.
 * @returns The verified payloads.
 */
export function verifyPreparedDesktopRuntime(desktopRoot: string, platform: NodeJS.Platform = process.platform): VerifiedDesktopRuntime[] {
  return verifyDesktopRuntimeTree(desktopRuntimeBuildPaths(desktopRoot).runtime, platform, expectedDesktopVersion(desktopRoot))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await prepareDesktopInterpreters({ desktopRoot: resolve(import.meta.dirname, '..') })
}
