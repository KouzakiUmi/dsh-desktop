import { expect, it } from 'vitest'
import { resolveDesktopShellEnvironment } from '../src/shell-environment.ts'

it('retains the inherited process environment on a packaged Windows launch', async () => {
  const resolution = await resolveDesktopShellEnvironment({
    environment: { PATH: 'C:\\Windows\\System32', LANG: 'en_US.UTF-8' },
    isPackaged: true,
  })
  expect(resolution).toEqual({ updates: {}, source: 'process', fallbackReason: 'windows' })
})

it('names an unpackaged launch so the diagnostic distinguishes it from a packaged one', async () => {
  const resolution = await resolveDesktopShellEnvironment({ environment: {}, isPackaged: false })
  expect(resolution).toEqual({ updates: {}, source: 'process', fallbackReason: 'not-packaged' })
})

it('never asks the caller to override an environment entry it inherited', async () => {
  const environment = { PATH: 'C:\\Windows\\System32', SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe' }
  const resolution = await resolveDesktopShellEnvironment({ environment, isPackaged: true })
  expect(resolution.updates).toEqual({})
  expect(resolution.source).toBe('process')
})
