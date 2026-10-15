import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

// Only the cache-directory scan is instrumented; every other filesystem call stays real so the
// fixtures keep exercising the production paths.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

import { NextUpdates, type NextUpdateOptions } from '../src/updates.ts'
import { updateAction, updateLabel } from '../src/update-state.ts'
import type { UpdateRequest } from '../adopted/src/update-checker.ts'
import type { UpdateArtifactRequest } from '../adopted/src/update-download.ts'

const realReaddir = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readdir
const roots: string[] = []
const owners: NextUpdates[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.mocked(readdir).mockReset()
  vi.mocked(readdir).mockImplementation(realReaddir)
  vi.useRealTimers()
})

/** Smallest byte sequence the Windows installer check accepts: an `MZ` header pointing at a PE signature. */
function windowsInstaller(): Buffer {
  const artifact = Buffer.alloc(1024)
  artifact.write('MZ', 0, 'latin1')
  artifact.writeUInt32LE(0x80, 0x3c)
  artifact.write('PE\0\0', 0x80, 'latin1')
  return artifact
}

async function fixture(overrides: Partial<NextUpdateOptions> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'next-updates-test-')); roots.push(home)
  const artifact = windowsInstaller()
  const request = vi.fn<UpdateRequest>(async url => url.includes('/version')
    ? Response.json({ version: '2.0.18-next.1', channel: 'next' }) : new Response(new Uint8Array(artifact), { headers: { 'content-length': '1024' } }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async (url, init) => ({ response: await request(url, init), finalUrl: url }))
  const options: NextUpdateOptions = { userData: home, version: '2.0.14-next', platform: 'win32', packaged: true,
    request, artifactRequest, prepare: vi.fn(async path => { expect(await readFile(path)).toEqual(artifact) }), install: vi.fn(async () => {}),
    changed: vi.fn(), log: vi.fn(), ...overrides }
  const updates = new NextUpdates(options); owners.push(updates)
  return { updates, options, request, artifactRequest }
}

it('checks without downloading; download completion waits for an explicit installation', async () => {
  const { updates, options, request } = await fixture()
  await updates.check()
  expect(updates.snapshot().phase).toBe('available')
  expect(request).toHaveBeenCalledTimes(1)
  await Promise.all([updates.download(), updates.download()])
  expect(updates.snapshot()).toMatchObject({ phase: 'ready', received: 1024, total: 1024 })
  expect(options.prepare).toHaveBeenCalledOnce()
  expect(options.install).not.toHaveBeenCalled()
  await updates.install()
  expect(options.install).toHaveBeenCalledOnce()
  expect(updates.snapshot().phase).toBe('installing')
})
it('does not confuse an unpublished channel, invalid response or network failure with up to date', async () => {
  for (const response of [new Response('', { status: 400 }), new Response('', { status: 503 }), Response.json({ version: '2.0.17', channel: 'stable' })]) {
    const { updates } = await fixture({ request: async () => response })
    await updates.check()
    expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'service' })
  }
})
it('allows checks in development, but never downloads or replaces the development application', async () => {
  const { updates, options, request } = await fixture({ packaged: false })
  await updates.check(); await updates.download()
  expect(updates.snapshot()).toMatchObject({ installable: false, error: 'development' })
  expect(request).toHaveBeenCalledOnce(); expect(options.prepare).not.toHaveBeenCalled()
})
it('refuses to download on a platform the product does not package', async () => {
  const { updates, options } = await fixture({ platform: 'darwin' })
  expect(updates.snapshot()).toMatchObject({ installable: false })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'unsupported' })
  expect(options.prepare).not.toHaveBeenCalled()
})
it('rechecks the selected version before downloading, and preserves preparation failures for retry', async () => {
  const { updates, options } = await fixture({ prepare: async () => { throw new Error('Signature mismatch') } })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'prepare' })
  await updates.install(); expect(options.install).not.toHaveBeenCalled()
  expect(updateAction(updates.snapshot())).toBe('download-update')
})
it('stops polling and aborts an active request on shutdown', async () => {
  const request = vi.fn<UpdateRequest>(async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
  const { updates } = await fixture({ request, packaged: false })
  const check = updates.check()
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  await updates.dispose(); await check
  expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
})
it('shows progress and an actionable downloaded state in both languages', () => {
  expect(updateLabel({ phase: 'downloading', installable: true, received: 25, total: 100 }, 'zh-CN')).toContain('25%')
  expect(updateLabel({ phase: 'downloading', installable: true, received: 2 * 1048576 }, 'en')).toContain('2 MB')
  expect(updateAction({ phase: 'preparing', installable: true })).toBeUndefined()
  expect(updateAction({ phase: 'ready', installable: true })).toBe('install-update')
})
it('downloads a Next installer through the injected artifact transport', async () => {
  const cdn = 'https://cdn-lfs-cn-1.modelscope.cn/prod/lfs-objects/next.exe'
  const artifact = windowsInstaller()
  const request = vi.fn<UpdateRequest>(async () => Response.json({ version: '2.0.18-next.1', channel: 'next' }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async () => ({ response: new Response(new Uint8Array(artifact)), finalUrl: cdn }))
  const { updates, options } = await fixture({ request, artifactRequest })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'ready', version: '2.0.18-next.1' })
  expect(artifactRequest).toHaveBeenCalledOnce()
  expect(options.prepare).toHaveBeenCalledOnce()
})
it('notifies once per newly discovered background update version and persists notifiedVersion across restarts', async () => {
  let latestVersion = '2.0.18-next.1'
  const available = vi.fn()
  const { updates, options } = await fixture({
    available,
    request: async () => Response.json({ version: latestVersion, channel: 'next' }),
  })
  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)
  expect(available).toHaveBeenCalledWith('2.0.18-next.1')

  // A later background poll of the same version does not re-announce it.
  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)

  // A new owner reading the same userData also skips the duplicate announcement.
  const secondAvailable = vi.fn()
  const restarted = new NextUpdates({ ...options, available: secondAvailable })
  owners.push(restarted)
  await restarted.check(true)
  expect(secondAvailable).not.toHaveBeenCalled()

  // A newer published version is announced once more.
  latestVersion = '2.0.19-next.1'
  await restarted.check(true)
  expect(secondAvailable).toHaveBeenCalledTimes(1)
  expect(secondAvailable).toHaveBeenCalledWith('2.0.19-next.1')
})
it('records a version the user checked explicitly so the next background poll stays silent', async () => {
  const available = vi.fn()
  const { updates } = await fixture({ available })
  await updates.check()
  await updates.check(true)
  expect(available).not.toHaveBeenCalled()
})

it('retries the cache preparation after a transient filesystem failure instead of poisoning the session', async () => {
  const { updates, options } = await fixture()
  const transient = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
  vi.mocked(readdir).mockImplementationOnce(() => { throw transient })
  await updates.check()
  // The failure stays visible instead of being swallowed by an empty catch.
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'download' })
  expect(options.log).toHaveBeenCalledWith(transient)
  // A later attempt retries the preparation and reaches the service again.
  await updates.check()
  expect(updates.snapshot()).toMatchObject({ phase: 'available' })
  expect(vi.mocked(readdir)).toHaveBeenCalledTimes(2)
})

it('still completes the cache preparation when the first attempt succeeds', async () => {
  const { updates } = await fixture()
  await updates.check()
  await updates.check(true)
  expect(updates.snapshot()).toMatchObject({ phase: 'available' })
  // The successful preparation stays memoized: one scan for the whole session.
  expect(vi.mocked(readdir)).toHaveBeenCalledTimes(1)
})
