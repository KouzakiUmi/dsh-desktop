import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const require = createRequire(resolve(import.meta.dirname, '../dsh-desktop-next/package.json'))
const manifest = require.resolve('pnpm')
const wanted = JSON.parse(readFileSync(resolve(import.meta.dirname, '../dsh-desktop-next/package.json'), 'utf8')).dependencies.pnpm
assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, wanted)
const source = readFileSync(join(dirname(manifest), 'dist/pnpm.mjs'), 'utf8')
const now = 1_700_000_000_000
class Clock extends Date { static now() { return now } }

function installedFunction(name, context = {}) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `Installed pnpm must expose ${name}`)
  assert.equal(source.indexOf(marker, start + marker.length), -1, `Ambiguous installed ${name}`)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start)
  return runInNewContext(`(${source.slice(start, end + 2)})`, { Date: Clock, ...context })
}

for (const value of [undefined, 0, '0', 60, '60']) {
  const normalized = value === 60 || value === '60' ? 60 : 0
  test(`pnpm ${wanted}: publication policy preserves minimum age ${String(value)}`, () => {
    const policy = installedFunction('getPublishedByPolicy')({ minimumReleaseAge: value })
    assert.equal(policy.publishedBy?.getTime(), normalized ? now - normalized * 60_000 : undefined)
  })
  test(`pnpm ${wanted}: verifier policy preserves minimum age ${String(value)}`, () => {
    let settings
    const create = installedFunction('createNpmResolutionVerifier', {
      createVerifierSettings(options) { settings = options; return options },
      snapshotVerifierPolicy(options) { return options },
    })
    const verifier = create({ minimumReleaseAge: value, trustPolicy: 'no-downgrade', now })
    assert.equal(settings.minimumReleaseAge, normalized)
    assert.equal(verifier.policy.minimumReleaseAge, normalized)
    assert.equal(settings.trustPolicy, 'no-downgrade')
    assert.equal(settings.now, now)
  })
}

test('installed pnpm keeps valid positive cutoffs enforceable and handles invalid date metadata', () => {
  const check = installedFunction('detectMinReleaseAgeViolation', { MINIMUM_RELEASE_AGE_VIOLATION_CODE: 'age-fixture' })
  const base = { name: 'fixture', version: '1.0.0', resolution: {}, publishedAt: new Clock(now).toISOString() }
  assert.equal(check({ ...base, publishedBy: new Clock(now - 60_000) }).code, 'age-fixture')
  assert.equal(check({ ...base, publishedBy: new Clock(now + 60_000) }), undefined)
  assert.equal(check({ ...base, publishedBy: new Clock(NaN) }), undefined)
  assert.equal(check({ ...base, publishedAt: 'invalid', publishedBy: new Clock(now) }), undefined)
})
