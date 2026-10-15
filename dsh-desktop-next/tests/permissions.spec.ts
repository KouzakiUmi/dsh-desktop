import { expect, it, vi } from 'vitest'
import { NativePermissions, type PermissionPlatform } from '../src/native-permissions.ts'
import type { DesktopPermissionStatus } from '../src/permissions.ts'

function fixture(platform = 'win32') {
  let status: DesktopPermissionStatus = 'not-determined'
  const native: PermissionPlatform = {
    platform, status: vi.fn(() => status), microphone: vi.fn(async () => { status = 'granted'; return true }),
    screen: vi.fn(async () => { status = 'granted' }), accessibility: vi.fn(async () => { status = 'granted' }), openSettings: vi.fn(async () => {}),
  }
  return { native, service: new NativePermissions(native), setStatus(value: DesktopPermissionStatus) { status = value } }
}

it('queries without prompting and reports that Windows grants consent outside the application', () => {
  const { service, native } = fixture()
  expect(service.query('microphone')).toEqual({ permission: 'microphone', status: 'not-determined', canRequest: false, canOpenSettings: true })
  expect(service.query('screen')).toEqual({ permission: 'screen', status: 'not-determined', canRequest: false, canOpenSettings: false })
  expect(native.microphone).not.toHaveBeenCalled()
  expect(native.screen).not.toHaveBeenCalled()
  expect(native.accessibility).not.toHaveBeenCalled()
})

it('never prompts in-process, so a request only rereads the current status', async () => {
  const { service, native, setStatus } = fixture()
  setStatus('denied')
  expect(await service.request('microphone')).toMatchObject({ status: 'denied', canRequest: false, canOpenSettings: true })
  setStatus('granted')
  expect((await service.request('screen')).status).toBe('granted')
  expect(await service.request('accessibility')).toMatchObject({ status: 'granted', canRequest: false, canOpenSettings: false })
  // Windows privacy settings own these grants; the application never asks on the user's behalf.
  expect(native.microphone).not.toHaveBeenCalled()
  expect(native.screen).not.toHaveBeenCalled()
  expect(native.accessibility).not.toHaveBeenCalled()
})

it('opens only the fixed Windows privacy pane and rejects an unknown permission', async () => {
  const { service, native } = fixture()
  await service.openSettings('microphone')
  expect(native.openSettings).toHaveBeenCalledWith('ms-settings:privacy-microphone')
  await expect(service.openSettings('screen')).rejects.toThrow('no Desktop permission settings shortcut')
  expect(() => service.query('https://example.com')).toThrow('Unsupported')
})
