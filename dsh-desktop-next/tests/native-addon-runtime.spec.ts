import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../..', import.meta.url))
interface Provenance {
  schemaVersion: number
  package: string
  version: string
  artifact: string
  sha256: string
  binarySha256: string
  source: { commit: string; patch: string; patchSha256: string }
  target: { os: string; cpu: string; backend: string; abi: string }
  runtime: { electron: string; node: string; v8: string }
}
const provenance = JSON.parse(readFileSync(join(root, 'vendor/node-addon-runtime/provenance.json'), 'utf8')) as Provenance
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

it('pins an explicitly versioned Windows x64 accessor artifact and its source patch', () => {
  const desktop = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const next = JSON.parse(readFileSync(join(root, 'dsh-desktop-next/package.json'), 'utf8'))
  expect(provenance.schemaVersion).toBe(1)
  expect(provenance.package).toBe('node-addon-require-builtin-win32-x64-msvc')
  expect(provenance.version).toMatch(/^0\.1\.9-desktop\./u)
  expect(provenance.source.commit).toMatch(/^[a-f0-9]{40}$/u)
  expect(provenance.target).toEqual({ os: 'win32', cpu: 'x64', backend: 'napi', abi: 'napi-v9' })
  expect(provenance.runtime.electron).toBe(next.devDependencies.electron)
  expect(desktop.resolutions[`${provenance.package}@npm:0.1.9`]).toBe(`file:vendor/node-addon-runtime/${provenance.artifact}`)
  expect(sha(join(root, 'vendor/node-addon-runtime', provenance.artifact))).toBe(provenance.sha256)
  expect(sha(join(root, provenance.source.patch))).toBe(provenance.source.patchSha256)
  const patch = readFileSync(join(root, provenance.source.patch), 'utf8')
  const node = provenance.runtime.node.split('.').map(Number)
  expect(node).toHaveLength(3)
  expect(node.every(Number.isSafeInteger)).toBe(true)
  expect(patch).toContain(`{"${provenance.runtime.electron}", ${node.join(', ')}, "${provenance.runtime.v8}"`)
})

it('loads the candidate package metadata without executing a native binding or changing the user cache', () => {
  const manifestPath = require.resolve(`${provenance.package}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  expect(manifest.version).toBe(provenance.version)
  expect(manifest.os).toEqual(['win32'])
  expect(manifest.cpu).toEqual(['x64'])
  expect(manifest.dependencies['node-addon-native-custom-loader']).toBe('0.1.9')
  const binary = join(dirname(manifestPath), 'prebuilt/win32-x64-msvc-napi-v9.node')
  expect(sha(binary)).toBe(provenance.binarySha256)
  const data = readFileSync(binary)
  expect(data.subarray(0, 2).toString()).toBe('MZ')
  expect(data.readUInt16LE(data.readUInt32LE(0x3c) + 4)).toBe(0x8664)
  expect(readFileSync(join(dirname(manifestPath), 'LICENSE'), 'utf8')).toContain('MIT License')
})
