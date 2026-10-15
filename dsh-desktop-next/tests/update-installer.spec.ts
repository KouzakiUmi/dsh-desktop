import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
const execFileMock = vi.fn()
vi.mock('node:child_process', () => {
  const fn = (...args: unknown[]) => execFileMock(...args)
  ;(fn as unknown as Record<symbol, unknown>)[promisify.custom] = (file: string, args: string[], opts: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFileMock(file, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  return {
    spawn: (...args: unknown[]) => spawnMock(...args),
    execFile: fn,
  }
})

import { assertNextWindowsInstaller, NextUpdateInstaller } from '../src/update-installer.ts'

const roots: string[] = []
afterEach(async () => {
  spawnMock.mockReset()
  execFileMock.mockReset()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function mockSpawnSuccess() {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
}

it('rejects an installer from another product and an unexpected release', () => {
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH NEXT', ProductVersion: '2.0.14-next' }, '2.0.14-next')).not.toThrow()
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH Desktop Beta', ProductVersion: '2.0.14-next' }, '2.0.14-next')).toThrow()
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH NEXT', ProductVersion: '2.0.13-next' }, '2.0.14-next')).toThrow()
})

it('refuses a prepared installer on a platform the product does not update', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next-update-')); roots.push(root)
  const installer = new NextUpdateInstaller({ platform: 'darwin', executable: '/Applications/DSH NEXT.app', log: vi.fn() })
  await expect(installer.prepare(join(root, 'update.exe'), '2.0.18-next.1', root, new AbortController().signal))
    .rejects.toThrow('Unsupported update platform')
  await expect(installer.stage()).rejects.toThrow('No prepared Next update')
})

it('launches the Windows NSIS installer visibly without /S so progress is shown before auto-restarting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next-win-update-')); roots.push(root)
  const exe = join(root, 'DSH-NEXT-Setup-2.0.18-next.1.exe')
  await writeFile(exe, 'installer')
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, JSON.stringify({
      ProductName: 'DSH NEXT',
      ProductVersion: '2.0.18-next.1',
    }), '')
  })
  mockSpawnSuccess()
  const installer = new NextUpdateInstaller({
    platform: 'win32',
    executable: 'C:\\Users\\user\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.exe',
    log: vi.fn(),
  })
  await installer.prepare(exe, '2.0.18-next.1', root, new AbortController().signal)
  await installer.stage()
  await installer.launch()
  expect(spawnMock).toHaveBeenCalledOnce()
  expect(spawnMock).toHaveBeenCalledWith(
    exe,
    ['--updated', '--force-run'],
    expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false }),
  )
})

it('refuses the installer handoff until a verified installer has been prepared', async () => {
  const installer = new NextUpdateInstaller({ platform: 'win32', executable: 'C:\\DSH NEXT.exe', log: vi.fn() })
  await expect(installer.stage()).rejects.toThrow('No prepared Next update')
  await expect(installer.launch()).rejects.toThrow('No prepared update installer')
  expect(spawnMock).not.toHaveBeenCalled()
})
