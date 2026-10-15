import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { expectedNextVersion, nextRuntimeBuildPaths, nextRuntimeTargets, officeSkillsDirectory, prepareNextRuntime, primaryRuntimeDirectory, verifyNextRuntimeTree, type NextRuntimeArch } from '../scripts/prepare-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

interface PayloadOptions {
  readonly manifest?: Record<string, unknown>
  readonly omit?: readonly string[]
}

/** Write the Windows payload the installed runtime resolves. */
function writePayload(runtimeRoot: string, arch: NextRuntimeArch, options: PayloadOptions = {}): string {
  const directory = primaryRuntimeDirectory(runtimeRoot, arch)
  const files: Record<string, Buffer | string> = {
    'runtime.json': JSON.stringify({ desktopVersion: '2.0.0-next', platform: 'win32', arch, payloadDigest: 'a'.repeat(64), python: '3.12.14', node: '24.21.0', pnpm: '11.8.0',
      pythonPackages: { numpy: '2.3.5' }, ...options.manifest }),
    'dependencies/python/python.exe': 'python',
    'dependencies/python/Lib/site-packages/numpy/__init__.py': '',
    'dependencies/node/bin/node.exe': 'node',
    'dependencies/node/node_modules/.keep': '',
    'dependencies/pnpm/bin/pnpm.mjs': 'export {}\n',
  }
  for (const [path, content] of Object.entries(files)) {
    if (options.omit?.includes(path)) continue
    mkdirSync(join(directory, path, '..'), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
  const skills = officeSkillsDirectory(runtimeRoot, arch)
  for (const path of ['office/SKILL.md', 'office-docx/SKILL.md', 'office-export-pdf/SKILL.md', 'office-pptx/SKILL.md', 'office-recalculate/SKILL.md', 'office-render/SKILL.md', 'office-xlsx/SKILL.md']) {
    if (options.omit?.includes(`office-skills/${path}`)) continue
    mkdirSync(join(skills, path, '..'), { recursive: true })
    writeFileSync(join(skills, path), '')
  }
  return directory
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'next-runtime-tree-'))
  roots.push(root)
  return root
}

it('ships only Windows x64 and rejects every unsupported platform or CPU', () => {
  expect(nextRuntimeTargets('win32', 'x64')).toEqual([{ target: 'win-x64', arch: 'x64' }])
  expect(() => nextRuntimeTargets('darwin')).toThrow('requires Windows x64')
  expect(() => nextRuntimeTargets('linux')).toThrow('requires Windows x64')
  expect(() => nextRuntimeTargets('win32', 'arm64')).toThrow('requires Windows x64')
  expect(() => nextRuntimeTargets('win32', 'ia32')).toThrow('requires Windows x64')
})

it.each(['darwin', 'linux'] as const)('rejects %s preparation before replacing an existing runtime', async platform => {
  const root = fixture()
  const runtime = nextRuntimeBuildPaths(root).runtime
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'keep.txt'), 'existing runtime')
  await expect(prepareNextRuntime({ desktopRoot: root, platform, version: '2.0.0-next' })).rejects.toThrow('requires Windows x64')
  expect(readFileSync(join(runtime, 'keep.txt'), 'utf8')).toBe('existing runtime')
})

it('lays out the payload beside its Office resources under the build directory', () => {
  expect(nextRuntimeBuildPaths('/next')).toEqual({ runtime: join('/next', '.desktop-build', 'runtime'), downloads: join('/next', '.desktop-build', 'downloads') })
  expect(primaryRuntimeDirectory('/resources/runtime', 'x64')).toBe(join('/resources/runtime', 'x64', 'primary-runtime'))
  expect(officeSkillsDirectory('/resources/runtime', 'x64')).toBe(join('/resources/runtime', 'x64', 'office-skills'))
})

it('reads the drill version over the source manifest', () => {
  const root = fixture()
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.17-next' }))
  expect(expectedNextVersion(root, {})).toBe('2.0.17-next')
  expect(expectedNextVersion(root, { DSH_NEXT_BUILD_VERSION: '2.0.18-next.1' })).toBe('2.0.18-next.1')
})

it('accepts a complete Windows x64 tree and reports its manifest', () => {
  const root = fixture()
  const x64 = writePayload(root, 'x64')
  expect(verifyNextRuntimeTree(root, 'win32', '2.0.0-next')).toEqual([
    { arch: 'x64', directory: x64, manifest: expect.objectContaining({ platform: 'win32', arch: 'x64', node: '24.21.0', pnpm: '11.8.0' }) },
  ])
  expect(() => verifyNextRuntimeTree(root, 'darwin', '2.0.0-next')).toThrow('requires Windows x64')
})

it('rejects a missing payload, another version, a foreign CPU or a payload without Node', () => {
  const missing = fixture()
  expect(() => verifyNextRuntimeTree(missing, 'win32', '2.0.0-next')).toThrow('missing x64 payload manifest')
  const version = fixture()
  writePayload(version, 'x64', { manifest: { desktopVersion: '2.0.1-next' } })
  expect(() => verifyNextRuntimeTree(version, 'win32', '2.0.0-next')).toThrow('declares version 2.0.1-next, expected 2.0.0-next')
  const swapped = fixture()
  writePayload(swapped, 'x64', { manifest: { arch: 'arm64' } })
  expect(() => verifyNextRuntimeTree(swapped, 'win32', '2.0.0-next')).toThrow('declares win32 arm64, expected win32 x64')
  const noNode = fixture()
  writePayload(noNode, 'x64', { manifest: { node: undefined, pnpm: undefined } })
  expect(() => verifyNextRuntimeTree(noNode, 'win32', '2.0.0-next')).toThrow('must bundle Node and pnpm')
})

it('rejects missing entry points and Office resources', () => {
  const python = fixture()
  writePayload(python, 'x64', { omit: ['dependencies/python/python.exe'] })
  expect(() => verifyNextRuntimeTree(python, 'win32', '2.0.0-next')).toThrow('missing x64 Python interpreter')
  const checker = fixture()
  writePayload(checker, 'x64', { omit: ['office-skills/office-render/SKILL.md'] })
  expect(() => verifyNextRuntimeTree(checker, 'win32', '2.0.0-next')).toThrow('missing x64 office-render skill')
})
