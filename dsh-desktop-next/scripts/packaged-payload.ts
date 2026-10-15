/** Read, audit and verify the archived Next payload after Electron Builder assembled it from the prepared tree. */
import { closeSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { dirname as posixDirname } from 'node:path/posix'
import { getRawHeader } from '@electron/asar'
import { nextRuntimeFileExclusion, type NextPackagingTarget } from './runtime-file-policy.ts'
import { DESKTOP_RUNTIME_FILE, parseDesktopRuntime, verifyPayload, type DesktopRuntimeDescriptor, type NextRelease, type PayloadEntry, type PayloadSource, type VerifyPayloadOptions } from '../src/runtime-tree.ts'

/** Application-relative directory holding the prepared payload that Electron Builder archives verbatim. */
export const PAYLOAD_DIR = '.desktop-build/payload'

/**
 * Architectures whose native dependencies one Next package carries. Next ships Windows x64 only,
 * so the payload descriptor records that single target and any other platform fails the build
 * rather than producing an artifact nothing installs.
 * @param platform - Electron platform being packaged.
 * @returns Platform and architectures recorded in the payload descriptor.
 * @throws For a platform Next does not package.
 */
export function nextPackagingTarget(platform: NodeJS.Platform): NextPackagingTarget {
  if (platform !== 'win32') throw new Error(`DSH NEXT packages Windows x64 only; received ${platform}`)
  return { platform, archs: ['x64'] }
}

interface AsarFile { readonly size: number; readonly offset?: string; readonly executable?: boolean; readonly unpacked?: boolean }
interface AsarDirectory { readonly files: Readonly<Record<string, AsarDirectory | AsarFile | { readonly link: string }>> }

/** The archive and its unpacked sibling; `close` releases the archive file descriptor. */
export interface ArchivedPayload extends PayloadSource {
  readonly archive: string
  /** The descriptor the archive carries at its root. */
  descriptor(): DesktopRuntimeDescriptor
  close(): void
}

/**
 * Open `app.asar` and `app.asar.unpacked` as one payload. Archive entries are read from their
 * recorded offsets; unpacked entries are the physical files Electron Builder placed beside the
 * archive. The descriptor entry is readable but, as in a prepared tree, outside the inventory.
 * @param resourcesDir - Application resources directory containing `app.asar`.
 * @returns The payload; call `close` when done.
 */
export function archivedPayload(resourcesDir: string): ArchivedPayload {
  const archive = join(resourcesDir, 'app.asar')
  const unpackedRoot = `${archive}.unpacked`
  const { header, headerSize } = getRawHeader(archive) as { header: AsarDirectory; headerSize: number }
  const dataOffset = 8 + headerSize
  let fd: number | undefined
  const descriptor = (): number => fd ??= openSync(archive, 'r')
  const entries = new Map<string, PayloadEntry>()
  const visit = (directory: AsarDirectory, prefix: string): void => {
    for (const [name, node] of Object.entries(directory.files)) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if ('files' in node) { visit(node, path); continue }
      if ('link' in node) throw new Error(`Next payload: unexpected archive link ${path}`)
      if (node.unpacked === true) {
        const physical = join(unpackedRoot, ...path.split('/'))
        const stat = lstatSync(physical, { throwIfNoEntry: false })
        if (stat === undefined || !stat.isFile()) throw new Error(`Next payload: unpacked entry ${path} has no physical file`)
        entries.set(path, { path, unpacked: true, executable: process.platform !== 'win32' && (stat.mode & 0o111) !== 0,
          read: () => readFileSync(physical) })
        continue
      }
      const { size } = node
      const offset = Number(node.offset)
      entries.set(path, { path, unpacked: false, executable: node.executable === true, read: () => {
        const buffer = Buffer.alloc(size)
        let done = 0
        while (done < size) {
          const read = readSync(descriptor(), buffer, done, size - done, dataOffset + offset + done)
          if (read === 0) throw new Error(`Next payload: truncated archive entry ${path}`)
          done += read
        }
        return buffer
      } })
    }
  }
  visit(header, '')
  const list = [...entries.values()].filter(entry => entry.path !== DESKTOP_RUNTIME_FILE).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return {
    archive, list: () => list, entry: path => entries.get(path),
    descriptor: () => {
      const entry = entries.get(DESKTOP_RUNTIME_FILE)
      if (entry === undefined) throw new Error(`Next payload: ${DESKTOP_RUNTIME_FILE} is missing from the archive`)
      return parseDesktopRuntime(JSON.parse(entry.read().toString('utf8')))
    },
    close: () => { if (fd !== undefined) { closeSync(fd); fd = undefined } },
  }
}

/**
 * Check that no unpacked application directory sits beside the archive. Nothing on Windows reads a
 * `Resources/app` directory: Electron loads `app.asar`, and the packaged manifest already lives
 * inside it as the application manifest the runtime and the updater's bundle check read.
 * @param resourcesDir - Application resources directory containing `app.asar`.
 */
export function verifyUpdaterManifestShim(resourcesDir: string): void {
  const directory = join(resourcesDir, 'app')
  if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined) {
    throw new Error('Next must not ship an unpacked application directory beside app.asar')
  }
}

/** Mach-O and ELF magic numbers; PE starts with `MZ`. */
const NATIVE_MAGIC = new Set([0xFEEDFACE, 0xFEEDFACF, 0xCEFAEDFE, 0xCFFAEDFE, 0xCAFEBABE, 0xBEBAFECA, 0x7F454C46])

function isNativeImage(head: Buffer): boolean {
  return head.length >= 4 && (NATIVE_MAGIC.has(head.readUInt32BE(0)) || (head[0] === 0x4D && head[1] === 0x5A))
}

/**
 * Entries another program opens by path: the shell runs the Node shims, the tray and window
 * read icons through `nativeImage`, pnpm starts as its own process with workers, and uv runs
 * the Connector project. All of them need physical files.
 */
const REQUIRED_UNPACKED = [
  /^scripts\/node-bin\//u, /^assets\//u, /^build\//u, /^node_modules\/pnpm\//u,
  /^node_modules\/@agents-anywhere\/dsh-bridge-next\/lib\/bundled-connector\//u,
  // The Creator preset mounts this package's skills through the Host's filesystem service, which stats with bigint
  // and gets plain-number stats for archived entries; the Host resolves the package manifest to this copy.
  /^node_modules\/@deepseek-ai\/dsh-agent-preset\//u,
  // The badge skill announces its `assets/` directory to the model as where to take `dsh-badge.png` from; shells and
  // the Host's filesystem service read no archive, and the Host resolves the package to this copy.
  /^node_modules\/@deepseek-ai\/dsh-skill-badge\//u,
  // The computer-use driver resolves its platform package's manifest and hands the library beside it to the system
  // loader; the Host resolves that package to this copy.
  /^node_modules\/@trycua\/cua-driver-/u,
  // The Office CLI and its direct dependencies run under the bundled standalone Node, which reads no archive;
  // beforePack unpacks the complete closure, and these guard its roots.
  /^node_modules\/@deepseek-ai\/libreoffice-kit\//u, /^node_modules\/(?:fflate|fontkit|koffi|saxes)\//u,
] as const

/** The only entries the prepared payload places at its root. */
const ALLOWED_ROOT_ENTRIES = new Set(['assets', 'build', 'cordis.patch.yml', DESKTOP_RUNTIME_FILE, 'host.cordis.patch.yml', 'lib', 'node_modules', 'package.json', 'scripts'])

/**
 * Audit an assembled payload: only the declared root entries may exist, nothing the Desktop file
 * policy omits may be present, and native code and shell-executed files must be unpacked, because
 * Electron's archive view serves only its own `fs` and `dlopen`, not child processes.
 * @param source - Assembled payload.
 * @param target - Platform and architectures of the package.
 * @returns Problems, one line each; empty when the payload passes.
 */
export function auditNextPayload(source: PayloadSource, target: NextPackagingTarget): string[] {
  const problems: string[] = []
  const strayRoots = new Set<string>()
  for (const entry of source.list()) {
    const root = entry.path.split('/')[0] ?? ''
    if (!ALLOWED_ROOT_ENTRIES.has(root)) { strayRoots.add(root); continue }
    if (entry.path.startsWith('node_modules/')) {
      const reason = nextRuntimeFileExclusion(entry.path.slice('node_modules/'.length), target)
      if (reason !== undefined) problems.push(`${entry.path}: ${reason} must not be packaged`)
    }
    if (entry.unpacked) continue
    if (REQUIRED_UNPACKED.some(pattern => pattern.test(entry.path))) problems.push(`${entry.path}: must be unpacked beside app.asar`)
    else if (isNativeImage(entry.read().subarray(0, 4))) problems.push(`${entry.path}: native code is packed inside app.asar`)
  }
  return [...[...strayRoots].sort().map(root => `${root}: outside the declared application files`), ...problems]
}

/**
 * Check the payload is complete and resolvable: the files the shell and Host open by name, and the
 * dependency closure every packaged manifest declares.
 * @param source - Assembled payload.
 */
export function verifyNextPayload(source: PayloadSource): void {
  // `host.cordis.patch.yml` and `scripts/node-bin` are read from the packaged application by the
  // Host: the overlay swaps the official webserver for Next's private loopback one, and the shims
  // put a `node` on the package manager's PATH. Both are invisible to a `yarn start` run, which
  // resolves them in the source tree, so only this check keeps them in the payload.
  for (const path of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs',
    'lib/native-ui/index.html', 'cordis.patch.yml', 'host.cordis.patch.yml',
    'scripts/node-bin/node', 'scripts/node-bin/node.cmd',
    'assets/licenses/shadcn.txt', 'assets/tray-icon-blue.png']) {
    if (source.entry(path) === undefined) throw new Error(`Missing Next payload: ${path}`)
  }
  const queued = ['package.json']
  const visited = new Set<string>()
  while (queued.length) {
    const manifestPath = queued.pop()!
    if (visited.has(manifestPath)) continue
    visited.add(manifestPath)
    const data = JSON.parse(source.entry(manifestPath)!.read().toString('utf8')) as {
      name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>; optionalDependencies?: Record<string, string>
    }
    // Required peers are runtime edges too: a plugin whose peer is absent throws on import and the
    // Host reports it as an entry that did not activate, long after packaging reported success.
    // They are the packages most easily missed, because the workspace resolves them from the
    // repository root even when this application never declares them.
    const optionalPeers = data.peerDependenciesMeta ?? {}
    const required = [...Object.keys(data.dependencies ?? {}),
      ...Object.keys(data.peerDependencies ?? {}).filter(name => optionalPeers[name]?.optional !== true)]
    for (const name of required) {
      let parent = posixDirname(manifestPath)
      let found: string | undefined
      while (true) {
        const candidate = `${parent === '.' ? '' : `${parent}/`}node_modules/${name}/package.json`
        if (source.entry(candidate) !== undefined) { found = candidate; break }
        if (parent === '.') break
        parent = posixDirname(parent)
      }
      if (found === undefined) {
        if (Object.hasOwn(data.optionalDependencies ?? {}, name)) continue
        throw new Error(`Missing packaged dependency ${name} required by ${String(data.name)}`)
      }
      queued.push(found)
    }
  }
  if (source.entry('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html') === undefined) throw new Error('Official Web frontend was not packaged')
}

function manifestVersion(source: PayloadSource, path: string, subject: string): string {
  const entry = source.entry(path)
  if (entry === undefined) throw new Error(`Next payload: ${subject} is missing`)
  const manifest = JSON.parse(entry.read().toString('utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error(`Next payload: ${subject} has no version`)
  return manifest.version
}

/**
 * Release facts of one assembled payload.
 * @param source - Assembled payload.
 * @param electronVersion - Electron release the package embeds.
 * @returns Shell, dsh, Electron and pnpm versions the descriptor records.
 */
export function nextPayloadRelease(source: PayloadSource, electronVersion: string): NextRelease {
  return {
    schemaVersion: 1,
    // electron-builder merges extraMetadata before archiving, so this is the version Electron reports.
    version: manifestVersion(source, 'package.json', 'the packaged manifest'),
    dshVersion: manifestVersion(source, 'node_modules/@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh'),
    electronVersion,
    pnpmVersion: manifestVersion(source, 'node_modules/pnpm/package.json', 'pnpm'),
  }
}

/** Outcome of the cross-check between an assembled archive and the prepared tree. */
export interface ArchiveCrossCheck {
  readonly descriptor: DesktopRuntimeDescriptor
}

/**
 * Cross-check an assembled archive against the descriptor the prepared tree was sealed with:
 * the archive must carry that descriptor byte for byte, and its files must match the inventory
 * exactly. The prepared tree and the archive are two independent copies of the installation.
 * @param source - Assembled archive.
 * @param preparedDescriptorFile - Descriptor file inside the prepared payload.
 * @param expectedVersion - Version the payload must declare.
 * @param target - Platform and architectures of the package.
 * @returns The verified descriptor.
 */
export function verifyArchiveAgainstPrepared(source: ArchivedPayload, preparedDescriptorFile: string, expectedVersion: string, target: NextPackagingTarget): ArchiveCrossCheck {
  const prepared = readFileSync(preparedDescriptorFile)
  const archived = source.entry(DESKTOP_RUNTIME_FILE)?.read()
  if (archived === undefined) throw new Error(`Next payload: ${DESKTOP_RUNTIME_FILE} is missing from the archive`)
  if (!archived.equals(prepared)) throw new Error('Next payload: the archived descriptor differs from the prepared one')
  const descriptor = verifyPayload(source, parseDesktopRuntime(JSON.parse(prepared.toString('utf8'))), expectedVersion, target)
  return { descriptor }
}

/**
 * Verify a final application's archive and unpacked files against the descriptor it carries.
 * @param resourcesDir - Application resources directory.
 * @param expectedVersion - Version the payload must declare.
 * @param target - Platform and architectures of the package.
 * @param options - Code-signing tolerance for a signed application.
 * @returns The verified descriptor.
 */
export function verifyNextRuntime(resourcesDir: string, expectedVersion: string, target: NextPackagingTarget, options: VerifyPayloadOptions = {}): DesktopRuntimeDescriptor {
  const source = archivedPayload(resourcesDir)
  try { return verifyPayload(source, source.descriptor(), expectedVersion, target, options) }
  finally { source.close() }
}
