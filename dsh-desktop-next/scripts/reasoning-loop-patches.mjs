/** Export version-bound Core runtime patches without changing installed dependencies or the payload. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, matchesGlob, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { list } from 'tar'
import { applyPatch, formatPatch, structuredPatch } from 'diff'

/** Packages whose compiled output implements the reasoning-loop capability. */
export const REASONING_PACKAGES = [
  'packages/llm/llm',
  'packages/core/agent',
  'packages/core/agent-loop',
  'packages/core/session',
  'packages/guard/repeat-tool-reminder',
  'packages/llm/llm-deepseek',
  'packages/llm/llm-pi-ai',
]

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const runtimeFile = path => path.startsWith('lib/') && (path.endsWith('.js') || path.endsWith('.d.ts'))

/** Read ordinary files from an npm archive in memory, never extract them. */
export async function readPackageArchive(file) {
  const entries = new Map()
  const failures = []
  await list({ file, strict: true, onReadEntry(entry) {
    if (entry.type === 'Directory') return
    if (entry.type !== 'File' || !entry.path.startsWith('package/')) {
      failures.push(`unsupported npm archive entry: ${entry.path}`)
      return
    }
    const path = entry.path.slice('package/'.length)
    if (path.includes('\\') || path.split('/').some(part => part === '' || part === '.' || part === '..') || entries.has(path)) {
      failures.push(`invalid or duplicate npm archive path: ${entry.path}`)
      return
    }
    const chunks = []
    entry.on('data', chunk => chunks.push(Buffer.from(chunk)))
    entry.on('end', () => entries.set(path, Buffer.concat(chunks)))
  } })
  if (failures.length > 0) throw new Error(failures.join('\n'))
  return entries
}

function compiledFiles(root, manifest) {
  const files = new Map()
  function visit(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}/${entry.name}`
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute, path)
      else if (entry.isFile() && runtimeFile(path) && manifest.files.some(pattern => matchesGlob(path, pattern))) {
        files.set(path, readFileSync(absolute))
      } else if (!entry.isFile()) throw new Error(`unsupported compiled entry: ${path}`)
    }
  }
  visit(join(root, 'lib'), 'lib')
  return files
}

/** Create a patch and verify every hunk recreates its intended compiled bytes. */
export function runtimePatch(before, after) {
  const chunks = []
  const files = []
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (!runtimeFile(path)) continue
    if (!after.has(path)) throw new Error(`compiled runtime file is missing: ${path}; build the owning package first`)
    const oldBytes = before.get(path)
    const newBytes = after.get(path)
    if (oldBytes?.equals(newBytes)) continue
    const oldText = oldBytes?.toString('utf8') ?? ''
    const newText = newBytes.toString('utf8')
    if (!Buffer.from(oldText).equals(oldBytes ?? Buffer.alloc(0)) || !Buffer.from(newText).equals(newBytes)) {
      throw new Error(`runtime patches require UTF-8 text: ${path}`)
    }
    const patch = structuredPatch(oldBytes === undefined ? '/dev/null' : `a/${path}`, `b/${path}`, oldText, newText, undefined, undefined, { context: 3 })
    Object.assign(patch, { isGit: true, ...(oldBytes === undefined ? { isCreate: true, newMode: '100644' } : {}) })
    const text = formatPatch(patch)
    if (applyPatch(oldText, text, { fuzzFactor: 0, autoConvertLineEndings: false }) !== newText) {
      throw new Error(`runtime patch self-check failed: ${path}`)
    }
    chunks.push(text)
    files.push({ path, beforeSha256: oldBytes === undefined ? null : digest(oldBytes), afterSha256: digest(newBytes) })
  }
  return { patch: chunks.join(''), files }
}

/** Prepare patch artifacts against the exact vendored archives; do not write package resolutions or lockfiles. */
export async function collectReasoningPatches({ coreRoot, desktopRoot, packages = REASONING_PACKAGES }) {
  const upstream = json(join(desktopRoot, 'upstream.json'))
  const channel = upstream.channels[upstream.activeChannel]
  const manifestPath = join(desktopRoot, channel.runtimeSource)
  const vendor = json(manifestPath)
  const core = json(join(coreRoot, 'package.json'))
  if (core.version !== channel.sourceVersion || vendor.version !== core.version || vendor.commit !== channel.commit) {
    throw new Error('Core version and vendored source identity must match the active Desktop baseline')
  }
  const outputs = []
  for (const directory of packages) {
    const root = join(coreRoot, directory)
    const manifest = json(join(root, 'package.json'))
    const baseline = vendor.packages.find(entry => entry.name === manifest.name)
    if (baseline === undefined || baseline.version !== manifest.version || manifest.version !== core.version) {
      throw new Error(`no matching vendored package: ${manifest.name}`)
    }
    if (basename(baseline.filename) !== baseline.filename) throw new Error(`invalid archive filename: ${baseline.filename}`)
    const archivePath = join(desktopRoot, channel.runtimeSource, '..', baseline.filename)
    const archive = readFileSync(archivePath)
    if (archive.length !== baseline.size || digest(archive) !== baseline.sha256) {
      throw new Error(`vendored archive integrity differs: ${baseline.filename}`)
    }
    const before = await readPackageArchive(archivePath)
    const original = JSON.parse(before.get('package.json').toString('utf8'))
    if (original.name !== manifest.name || original.version !== manifest.version) throw new Error(`archive identity differs: ${baseline.filename}`)
    const result = runtimePatch(before, compiledFiles(root, manifest))
    if (result.files.length === 0) continue
    const filename = `${manifest.name.slice('@deepseek-ai/'.length)}@${manifest.version}.patch`
    outputs.push({ filename, ...result, package: manifest.name, archive: baseline.filename, archiveSha256: baseline.sha256 })
  }
  return { baseline: { commit: channel.commit, version: core.version }, outputs }
}

/** Write new, reviewable artifacts only; refuse to replace existing output. */
export function writeReasoningPatches(output, result) {
  const paths = [...result.outputs.map(entry => join(output, entry.filename)), join(output, 'reasoning-loop-patches.json')]
  for (const path of paths) if (existsSync(path)) throw new Error(`patch output already exists: ${path}`)
  mkdirSync(output, { recursive: true })
  for (const entry of result.outputs) writeFileSync(join(output, entry.filename), entry.patch, { flag: 'wx' })
  const record = {
    schemaVersion: 1,
    baseline: result.baseline,
    packages: result.outputs.map(({ patch, ...entry }) => ({ ...entry, patchSha256: digest(Buffer.from(patch)) })),
  }
  writeFileSync(join(output, 'reasoning-loop-patches.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { 'core-root': { type: 'string' }, output: { type: 'string' } } })
  if (values['core-root'] === undefined || values.output === undefined) throw new Error('usage: node scripts/reasoning-loop-patches.mjs --core-root <built Core checkout> --output <new artifact directory>')
  const desktopRoot = resolve(import.meta.dirname, '../..')
  const coreRoot = resolve(values['core-root'])
  const result = await collectReasoningPatches({ coreRoot, desktopRoot })
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: coreRoot, encoding: 'utf8' }).trim()
  if (sourceCommit !== result.baseline.commit) throw new Error('the Core checkout must be based on the exact vendored baseline commit')
  if (result.outputs.length === 0) throw new Error('no compiled runtime differences; build the changed Core packages before exporting')
  writeReasoningPatches(resolve(values.output), result)
  console.log(`Exported ${result.outputs.length} version-bound patches; dependencies, lockfiles and sealed payload are unchanged.`)
}
