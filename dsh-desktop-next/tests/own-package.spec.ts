import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installOwnPackageResolution } from '../src/host/own-package.ts'

const roots: string[] = []
const hooks: ModuleHooks[] = []
afterEach(() => {
  for (const hook of hooks.splice(0)) hook.deregister()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(exports: Record<string, string | { types: string; default: string }> = {
  '.': './main.cjs', './webserver': './webserver.cjs', './permissions': { types: './permissions.d.ts', default: './webserver.cjs' },
}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-own-package-')))
  roots.push(root)
  const runtime = join(root, 'app.asar')
  mkdirSync(runtime)
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'dsh-desktop-next', exports }))
  writeFileSync(join(runtime, 'main.cjs'), 'module.exports = { source: "own-package" }')
  writeFileSync(join(runtime, 'webserver.cjs'), 'module.exports = { source: "own-webserver" }')
  return { root, runtime, require: createRequire(join(root, 'profile', 'package.json')) }
}

it('resolves only declared application exports from an importer outside the archive', () => {
  const f = fixture()
  const hook = installOwnPackageResolution(f.runtime)!
  hooks.push(hook)
  expect(f.require('dsh-desktop-next')).toEqual({ source: 'own-package' })
  expect(f.require('dsh-desktop-next/webserver')).toEqual({ source: 'own-webserver' })
  expect(f.require('dsh-desktop-next/permissions')).toEqual({ source: 'own-webserver' })
  expect(() => f.require('dsh-desktop-next/private')).toThrow()
  expect(f.require('node:path')).toBe(createRequire(import.meta.url)('node:path'))
})

it('rejects an export outside the application instead of routing it', () => {
  const f = fixture({ '.': './../outside.cjs' })
  expect(() => installOwnPackageResolution(f.runtime)).toThrow('escapes its package')
})

it('does not intercept the physical development package', () => {
  const f = fixture()
  expect(installOwnPackageResolution(f.root)).toBeUndefined()
})
