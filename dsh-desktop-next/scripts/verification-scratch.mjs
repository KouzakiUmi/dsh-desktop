/** Private checkout-owned userData/sessionData for native gates consuming the current build. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupDisposableTree } from '../lib/disposable-tree.js'

/** Checkout-local parent of the gates' atomically allocated private directories. */
export const VERIFICATION_ROOT = join(realpathSync(fileURLToPath(new URL('..', import.meta.url))), '.desktop-build', 'verification')

/** Refuse a host the Windows x64 product does not ship. */
export function requireWindowsX64(subject) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`${subject} requires Windows x64; this host is ${process.platform} ${process.arch}`)
  }
}

/** Allocate a private home without requiring a system TEMP write grant. */
export function createVerificationHome(prefix) {
  mkdirSync(VERIFICATION_ROOT, { recursive: true })
  assert.equal(realpathSync(VERIFICATION_ROOT), VERIFICATION_ROOT, 'Verification files must remain inside the checkout')
  const home = mkdtempSync(join(VERIFICATION_ROOT, prefix))
  assert.ok(resolve(home).startsWith(VERIFICATION_ROOT + sep), 'Verification files must remain inside the checkout')
  return home
}

/** Validate a launcher-owned home handed to an Electron child. */
export function isVerificationHome(home, prefix) {
  if (typeof home !== 'string' || home === '') return false
  const resolved = resolve(home)
  return dirname(resolved) === VERIFICATION_ROOT && basename(resolved).startsWith(prefix)
}

/** Remove only a private home, using the production alias-aware cleanup after its child exits. */
export function removeVerificationHome(home, prefix) {
  if (!isVerificationHome(home, prefix)) {
    throw new Error(`Refusing to remove a directory this gate did not allocate: ${String(home)}`)
  }
  assert.equal(realpathSync(VERIFICATION_ROOT), VERIFICATION_ROOT, 'Verification files must remain inside the checkout')
  cleanupDisposableTree(home)
}
