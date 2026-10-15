import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { create } from 'tar'
import { applyPatch, parsePatch } from 'diff'
import { afterEach, expect, it } from 'vitest'
import { collectReasoningPatches, readPackageArchive, runtimePatch, writeReasoningPatches } from '../scripts/reasoning-loop-patches.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const bytes = (text: string) => Buffer.from(text)
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value)}\n`)

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'reasoning-patches-'))
  roots.push(root)
  const core = join(root, 'core')
  const desktop = join(root, 'desktop')
  const packageRoot = join(core, 'packages', 'llm', 'llm')
  const archiveRoot = join(root, 'archive')
  const vendorRoot = join(desktop, 'vendor')
  for (const directory of [join(packageRoot, 'lib'), join(archiveRoot, 'package', 'lib'), vendorRoot]) mkdirSync(directory, { recursive: true })
  const manifest = { name: '@deepseek-ai/dsh-llm', version: '0.2.1-alpha.3', files: ['lib/index.js', 'lib/types/**/*.d.ts'] }
  writeJson(join(core, 'package.json'), { version: manifest.version })
  writeJson(join(packageRoot, 'package.json'), manifest)
  writeJson(join(archiveRoot, 'package', 'package.json'), manifest)
  writeFileSync(join(archiveRoot, 'package', 'lib', 'index.js'), 'export const guard = false\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), 'export const guard = true\n')
  const filename = 'deepseek-ai-dsh-llm-0.2.1-alpha.3.tgz'
  const archive = join(vendorRoot, filename)
  await create({ gzip: true, cwd: archiveRoot, file: archive }, ['package'])
  const commit = 'a'.repeat(40)
  writeJson(join(desktop, 'upstream.json'), { activeChannel: 'next', channels: { next: { commit, sourceVersion: manifest.version, runtimeSource: 'vendor/manifest.json' } } })
  writeJson(join(vendorRoot, 'manifest.json'), { version: manifest.version, commit, packages: [{ name: manifest.name, version: manifest.version, filename, size: readFileSync(archive).length, sha256: sha256(readFileSync(archive)) }] })
  return { root, core, desktop, packageRoot, archive, vendorRoot }
}

it('exports patches against verified archives without editing dependencies or baseline bytes', async () => {
  const value = await fixture()
  const original = readFileSync(value.archive)
  const result = await collectReasoningPatches({ coreRoot: value.core, desktopRoot: value.desktop, packages: ['packages/llm/llm'] })
  expect(result.outputs).toHaveLength(1)
  const patch = result.outputs[0]
  assert.ok(patch)
  expect(patch.filename).toBe('dsh-llm@0.2.1-alpha.3.patch')
  expect(patch.patch).toMatch(/^diff --git a\/lib\/index\.js b\/lib\/index\.js\n--- a\/lib\/index\.js\n\+\+\+ b\/lib\/index\.js\n/)
  expect(patch.files).toEqual([expect.objectContaining({ path: 'lib/index.js' })])
  expect(applyPatch('export const guard = false\n', patch.patch)).toBe('export const guard = true\n')
  const output = join(value.root, 'patches')
  writeReasoningPatches(output, result)
  expect(readFileSync(join(output, patch.filename), 'utf8')).toBe(patch.patch)
  expect(JSON.parse(readFileSync(join(output, 'reasoning-loop-patches.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, baseline: { commit: 'a'.repeat(40) } })
  expect(readFileSync(value.archive)).toEqual(original)
  const checkRoot = join(value.root, 'check')
  for (const [path, content] of await readPackageArchive(value.archive)) {
    const target = join(checkRoot, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  expect(() => execFileSync('git', ['apply', '--check', join(output, patch.filename)], { cwd: checkRoot, stdio: 'pipe' })).not.toThrow()
  expect(existsSync(join(value.desktop, 'node_modules'))).toBe(false)
  expect(() => writeReasoningPatches(output, result)).toThrow('already exists')
})

it('includes new published declarations but excludes unpublished compiled siblings', async () => {
  const value = await fixture()
  mkdirSync(join(value.packageRoot, 'lib', 'types'), { recursive: true })
  writeFileSync(join(value.packageRoot, 'lib', 'types', 'guard.d.ts'), 'export declare const guard: boolean\n')
  writeFileSync(join(value.packageRoot, 'lib', 'types', 'guard.js'), 'export const guard = true\n')
  const result = await collectReasoningPatches({ coreRoot: value.core, desktopRoot: value.desktop, packages: ['packages/llm/llm'] })
  const patch = result.outputs[0]
  assert.ok(patch)
  expect(patch.files.map(file => file.path)).toEqual(['lib/index.js', 'lib/types/guard.d.ts'])
  const additions = parsePatch(patch.patch).filter(item => item.isCreate)
  expect(additions).toHaveLength(1)
  expect(patch.patch).toContain('diff --git a/lib/types/guard.d.ts b/lib/types/guard.d.ts\nnew file mode 100644\n--- /dev/null\n+++ b/lib/types/guard.d.ts\n')
  const addition = additions[0]
  assert.ok(addition)
  expect(applyPatch('', addition)).toBe('export declare const guard: boolean\n')
})

it('fails on version drift or corrupted baseline archives before emitting anything', async () => {
  const value = await fixture()
  writeJson(join(value.core, 'package.json'), { version: '0.2.1-alpha.4' })
  await expect(collectReasoningPatches({ coreRoot: value.core, desktopRoot: value.desktop, packages: ['packages/llm/llm'] })).rejects.toThrow('identity must match')
  writeJson(join(value.core, 'package.json'), { version: '0.2.1-alpha.3' })
  writeFileSync(value.archive, 'not the recorded archive')
  await expect(collectReasoningPatches({ coreRoot: value.core, desktopRoot: value.desktop, packages: ['packages/llm/llm'] })).rejects.toThrow('integrity differs')
})

it('does not turn missing build outputs into runtime file deletions', () => {
  expect(() => runtimePatch(new Map([['lib/index.js', bytes('old\n')]]), new Map())).toThrow('build the owning package first')
  expect(() => runtimePatch(new Map(), new Map([['lib/index.js', Buffer.from([255])]]))).toThrow('UTF-8')
})

it('joins multi-file patches without uncounted context lines between diffs', () => {
  const result = runtimePatch(
    new Map([['lib/a.js', bytes('export const a = false\n')], ['lib/b.js', bytes('export const b = false\n')]]),
    new Map([['lib/a.js', bytes('export const a = true\n')], ['lib/b.js', bytes('export const b = true\n')]]),
  )
  expect(parsePatch(result.patch)).toHaveLength(2)
  expect(result.patch).not.toContain('\n\ndiff --git ')
})

it('installs the seven exact reasoning-loop outputs through the active vendored patch cohort', () => {
  interface Cohort {
    baseline: { version: string; commit: string }
    packages: { package: string; filename: string; archive: string; patchSha256: string; files: { path: string; afterSha256: string }[] }[]
  }
  const desktop = fileURLToPath(new URL('../..', import.meta.url))
  const candidateRoot = join(desktop, 'patches/reasoning-loop/0.2.1-alpha.3')
  const cohort = JSON.parse(readFileSync(join(candidateRoot, 'reasoning-loop-patches.json'), 'utf8')) as Cohort
  const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
  const require = createRequire(import.meta.url)
  expect(cohort.packages).toHaveLength(7)
  for (const entry of cohort.packages) {
    const candidate = readFileSync(join(candidateRoot, entry.filename))
    expect(sha256(candidate)).toBe(entry.patchSha256)
    expect(readFileSync(join(desktop, 'patches', entry.filename), 'utf8'))
      .toBe(candidate.toString('utf8').replace(/\n\n(?=diff --git )/gu, '\n'))
    const expected = `patch:${entry.package}@file%3Avendor/dsh-runtime/${cohort.baseline.version}/${entry.archive}#./patches/${entry.filename}`
    for (const range of [cohort.baseline.version, `^${cohort.baseline.version}`]) {
      expect(manifest.resolutions[`${entry.package}@npm:${range}`]).toBe(expected)
    }
    const installed = require.resolve(`${entry.package}/package.json`)
    expect(JSON.parse(readFileSync(installed, 'utf8')).version).toBe(cohort.baseline.version)
    for (const file of entry.files) expect(sha256(readFileSync(join(dirname(installed), file.path)))).toBe(file.afterSha256)
  }
})

it('gates local builds and Windows installers on the installed patch cohort', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.scripts['verify:reasoning-loop']).toBe('vitest run tests/reasoning-loop-patches.spec.ts')
  expect(manifest.scripts.build).toMatch(/^yarn verify:reasoning-loop && /u)
  expect(manifest.scripts['dist:win']).toBe('yarn verify:reasoning-loop && node scripts/package.ts win')
  expect(manifest.scripts['package:dir']).toMatch(/^yarn build && /u)
})

it('reads archives without extracting their files', async () => {
  const value = await fixture()
  expect((await readPackageArchive(value.archive)).get('lib/index.js')?.toString()).toBe('export const guard = false\n')
  expect(existsSync(join(value.desktop, 'package'))).toBe(false)
})
