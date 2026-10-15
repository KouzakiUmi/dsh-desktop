/** Verify the vendored native accessor in a real Electron main process, without a window. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app } from 'electron'
import { isVerificationHome } from './verification-scratch.mjs'

const home = process.argv[process.argv.indexOf('--verification-home') + 1]
assert.ok(isVerificationHome(home, 'native-builtins-'), 'Expected the launcher-owned private home')
app.setPath('userData', home)
app.setPath('sessionData', home)
process.env.NARB_NATIVE_CACHE_DIR = join(home, 'native-cache')

async function main() {
  await app.whenReady()
  const require = createRequire(import.meta.url)
  const addon = require('node-addon-require-builtin')
  const info = addon.getBindingInfo()
  assert.equal(info.product, 'require-builtin')
  assert.equal(info.backend, 'napi')
  assert.equal(info.abi, 'napi-v9')
  assert.equal(typeof addon.requireBuiltin('internal/modules/cjs/loader').Module, 'function')
  assert.equal(typeof addon.requireBuiltin('internal/modules/esm/loader').register, 'function')
  assert.equal(typeof addon.requireBuiltin('internal/bootstrap/realm').BuiltinModule, 'function')
  assert.throws(() => addon.requireBuiltin(), /moduleId must be a string/)
  console.log(`Native builtin access passed in Electron ${process.versions.electron}: ${process.platform} ${process.arch}, Node ${process.versions.node}, V8 ${process.versions.v8}`)
}

void main().then(() => app.exit(0), error => {
  console.error(error)
  app.exit(1)
})
