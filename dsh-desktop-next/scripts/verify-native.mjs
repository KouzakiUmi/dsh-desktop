/** Own the hidden Electron child and remove its private profile only after process exit. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createVerificationHome, removeVerificationHome, requireWindowsX64 } from './verification-scratch.mjs'

const modes = new Map([
  ['protocol', { script: 'verify-protocol.mjs', prefix: 'protocol-', args: [] }],
  ['sidebar-browser', { script: 'verify-sidebar-browser.mjs', prefix: 'sidebar-browser-', args: [] }],
  ['plugin-frames', { script: 'verify-protocol.mjs', prefix: 'plugin-frames-', args: ['--plugin-frames'] }],
])
const mode = modes.get(process.argv[2])
if (!mode) throw new Error('Expected protocol, sidebar-browser or plugin-frames')
requireWindowsX64('Native Electron verification')
const home = createVerificationHome(mode.prefix)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let failure
try {
  const electron = createRequire(import.meta.url)('electron')
  const entry = fileURLToPath(new URL(mode.script, import.meta.url))
  const child = spawnSync(electron, [entry, ...mode.args, '--verification-home', home, ...process.argv.slice(3)], {
    env, stdio: 'inherit', windowsHide: true, timeout: 90_000,
  })
  if (child.error) throw child.error
  assert.equal(child.signal, null, 'Native Electron verification was interrupted')
  assert.equal(child.status, 0, 'Native Electron verification failed')
} catch (error) { failure = error }
try { removeVerificationHome(home, mode.prefix) } catch (error) {
  failure = failure ? new AggregateError([failure, error], 'Native verification and profile cleanup failed') : error
}
if (failure) throw failure
