import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { runNextPackagingCommand } from '../scripts/packaging-command.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
const spawn = vi.mocked(spawnSync)
afterEach(() => spawn.mockReset())
const succeeded: ReturnType<typeof spawnSync> = { status: 0, output: [], pid: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }

it('forwards the Windows package gate verbatim and aborts packaging when it fails', () => {
  const env = { PATH: 'C:\\bin' }
  const args = ['/d', '/s', '/c', 'corepack yarn workspace dsh-desktop-next check:win-package']
  spawn.mockReturnValue(succeeded)
  runNextPackagingCommand('cmd.exe', args, 'C:\\workspace', env)
  expect(spawn).toHaveBeenCalledOnce()
  expect(spawn.mock.calls[0]?.[0]).toBe('cmd.exe')
  expect(spawn.mock.calls[0]?.[1]).toEqual(args)
  expect(spawn.mock.calls[0]?.[2]?.env).toBe(env)
  expect(spawn.mock.calls[0]?.[2]?.stdio).toBe('inherit')

  spawn.mockReset().mockReturnValue({ ...succeeded, status: 1 })
  expect(() => runNextPackagingCommand('cmd.exe', args, 'C:\\workspace', env)).toThrow('Packaging command failed')
  expect(spawn).toHaveBeenCalledOnce()
})

it('surfaces a launcher failure instead of misreporting it as a packaging exit code', () => {
  spawn.mockReturnValue({ ...succeeded, error: new Error('spawn ENOENT'), status: null })
  expect(() => runNextPackagingCommand('cmd.exe', ['/c', 'x'], 'C:\\workspace', {})).toThrow('spawn ENOENT')
})
