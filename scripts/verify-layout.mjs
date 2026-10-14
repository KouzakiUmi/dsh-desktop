import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const fail = message => { throw new Error(`verify-layout: ${message}`) }

const workspace = readJson('package.json')
const upstream = readJson('upstream.json')
const nextDesktop = readJson('dsh-desktop-next/package.json')
const nextReference = readJson('dsh-desktop-next/upstream-reference.json')
const fabric = readJson('dsh-community-fabric/package.json')
const market = readJson('dsh-community-market/package.json')
const upstreamPackage = readJson('deepseek-harness/package.json')

if (upstream.activeChannel !== 'next') fail('the pinned upstream checkout must follow the Next channel')
const activeUpstream = upstream.channels?.[upstream.activeChannel]
if (activeUpstream === undefined) fail('the active upstream channel is missing')

if (workspace.packageManager !== 'yarn@4.18.0') {
  fail('the product workspace must pin yarn@4.18.0')
}
if (JSON.stringify(workspace.workspaces) !== JSON.stringify([
  'dsh-desktop-next',
  'dsh-community-fabric',
  'dsh-community-market',
])) {
  fail('the root Yarn workspace must contain Next, community-fabric, and community-market')
}
for (const [name, manifest] of [
  ['dsh-desktop-next', nextDesktop],
  ['dsh-community-fabric', fabric],
  ['dsh-community-market', market],
]) {
  if (manifest.packageManager !== undefined) fail(`${name} must inherit the root Yarn release`)
}
if (fabric.name !== 'dsh-community-fabric') fail('the Fabric workspace must own dsh-community-fabric')
if (market.name !== 'dsh-community-market') fail('the market workspace must own dsh-community-market')
const claudePath = resolve(root, 'CLAUDE.md')
const claudeStat = lstatSync(claudePath)
// Windows checkouts materialize the symlink as a regular file holding the
// target name; accept both forms so the pointer stays verified on every host.
const claudeTarget = claudeStat.isSymbolicLink()
  ? readlinkSync(claudePath)
  : readFileSync(claudePath, 'utf8').trim()
if (claudeTarget !== 'AGENTS.md') {
  fail('CLAUDE.md must link to the outer repository AGENTS.md')
}
for (const legacyFile of [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'dsh-desktop-next/pnpm-lock.yaml',
  'dsh-desktop-next/pnpm-workspace.yaml',
  'dsh-community-fabric/pnpm-lock.yaml',
  'dsh-community-fabric/pnpm-workspace.yaml',
  'dsh-community-market/pnpm-lock.yaml',
  'dsh-community-market/pnpm-workspace.yaml',
]) {
  if (existsSync(resolve(root, legacyFile))) fail(`${legacyFile} must not exist`)
}
if (run('git', ['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.path']) !== 'deepseek-harness') {
  fail('the upstream submodule path must be deepseek-harness')
}
if (run('git', ['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.url']) !== upstream.repository) {
  fail('the upstream submodule URL differs from upstream.json')
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream checkout must retain its pnpm package manager')
}

for (const [owner, manifest] of [
  ['root', workspace],
  ['next desktop', nextDesktop],
  ['fabric', fabric],
  ['market', market],
]) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'resolutions']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== 'string') continue
      if (/^(?:workspace|portal|link):/u.test(range)
        || (range.startsWith('file:') && range.includes('deepseek-harness'))) {
        fail(`${owner} ${field}.${name} bypasses the published DSH package boundary`)
      }
    }
  }
}

const [mode, object] = run('git', ['ls-files', '--stage', '--', 'deepseek-harness']).split(/\s+/u)
if (mode !== '160000') fail('deepseek-harness must be tracked as a Git submodule')
if (object !== activeUpstream.commit) fail(`submodule index is ${object}, expected ${activeUpstream.commit}`)

const upstreamDir = resolve(root, 'deepseek-harness')
if (run('git', ['rev-parse', 'HEAD'], upstreamDir) !== activeUpstream.commit) {
  fail('checked-out upstream commit differs from upstream.json')
}
if (run('git', ['status', '--porcelain'], upstreamDir) !== '') {
  fail('deepseek-harness contains local changes')
}
if (run('git', ['remote', 'get-url', 'origin'], upstreamDir) !== upstream.repository) {
  fail('deepseek-harness origin differs from upstream.json')
}
if (upstreamPackage.version !== activeUpstream.sourceVersion) {
  fail('deepseek-harness package version differs from upstream.json')
}
const nextChannel = upstream.channels?.next
if (nextChannel?.package !== 'dsh-desktop-next') fail('the Next upstream metadata points at the wrong package')

if (nextDesktop.name !== 'dsh-desktop-next' || nextDesktop.private !== true) fail('Next must remain a private experimental package')
for (const [name, version] of Object.entries(nextDesktop.dependencies)) {
  if ((name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) && version !== nextReference.version) fail(`Next ${name} must match the pinned upstream family`)
}

process.stdout.write(`verify-layout: Desktop workspaces including Next and upstream ${activeUpstream.commit.slice(0, 10)} are consistent\n`)
