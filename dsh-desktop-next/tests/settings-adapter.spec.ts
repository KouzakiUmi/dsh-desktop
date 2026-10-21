import { afterEach, expect, it, vi } from 'vitest'
import { NextSettingsAdapter, projectSettings } from '../src/client/settings-adapter.ts'
import { installWindowStyles } from '../src/client/styles.ts'
import { installDesktopSettingsStyles } from '../src/client/desktop-settings-styles.ts'
import { DEFAULT_PREFERENCES, type DesktopBridge, type DesktopBrowserLinks, type DesktopCommand, type DesktopState } from '../src/desktop-contract.ts'

afterEach(() => { vi.unstubAllGlobals() })

function fixture() {
  const state: DesktopState = {
    selected: 'desktop', profiles: ['desktop', 'work', 'broken'], unavailableProfiles: ['broken'],
    features: { market: true, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
    phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture', platform: 'win32', version: '0.1.0',
    trayAvailable: true, notificationsAvailable: true, browserUrl: null, lan: null, checkpoint: null, logs: '',
  }
  const commands: DesktopCommand[] = []
  const links: DesktopBrowserLinks = { localUrl: null, lanUrls: [] }
  let fail = false
  const bridge: DesktopBridge = {
    state: async () => structuredClone(state),
    browserLinks: async () => structuredClone(links),
    command: async command => {
      commands.push(command)
      if (fail) { fail = false; throw new Error('Fixture save failure') }
      if (command.type === 'preferences') state.preferences = command.preferences
      if (command.type === 'switch') state.selected = command.name
    },
  }
  return { state, links, commands, bridge, rejectNext: () => { fail = true }, adapter: new NextSettingsAdapter(bridge) }
}

it('shares stable subscription snapshots and serializes independent preference writes', async () => {
  const { adapter, state } = fixture()
  await adapter.refresh()
  const original = adapter.desktopSettings.getSnapshot()
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot()).toBe(original)
  await Promise.all([
    adapter.notificationSettings.set('enabled', false),
    adapter.savePreferences({ closeToTray: false, port: 12345 }),
  ])
  expect(state.preferences).toMatchObject({ notifications: false, closeToTray: false, port: 12345 })
  expect(adapter.notificationSettings.getSnapshot().value?.enabled).toBe(false)
  expect(adapter.desktopSettings.getSnapshot().value?.port).toBe(12345)
})

it('keeps controls writable and snapshots stable through unrelated busy-state refreshes', async () => {
  const { adapter, state } = fixture()
  await adapter.refresh()
  const shell = adapter.desktopSettings.getSnapshot()
  const notifications = adapter.notificationSettings.getSnapshot()
  state.busy = true
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot()).toBe(shell)
  expect(adapter.notificationSettings.getSnapshot()).toBe(notifications)
  expect(shell.writable).toBe(true)
  expect(notifications.writable).toBe(true)
  state.notificationsAvailable = false
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot()).toBe(shell)
  expect(adapter.notificationSettings.getSnapshot().writable).toBe(false)
})

it('publishes ordinary preference intent immediately without optimistic LAN or port confirmation', async () => {
  const { adapter, bridge } = fixture()
  await adapter.refresh()
  let release!: () => void
  let calls = 0
  const command = bridge.command
  bridge.command = async value => {
    calls += 1
    await new Promise<void>(resolve => { release = resolve })
    await command(value)
  }
  const saving = adapter.desktopSettings.set('openBrowser', true)
  expect(adapter.desktopSettings.getSnapshot().value?.openBrowser).toBe(true)
  await vi.waitFor(() => { expect(calls).toBe(1) })
  release()
  await saving

  const lan = adapter.desktopSettings.set('networkExposure', 'lan')
  expect(adapter.desktopSettings.getSnapshot().value?.networkExposure).toBe('loopback')
  await vi.waitFor(() => { expect(calls).toBe(2) })
  release()
  await lan

  const port = adapter.savePreferences({ port: 12345 })
  expect(adapter.desktopSettings.getSnapshot().value?.port).toBe(0)
  await vi.waitFor(() => { expect(calls).toBe(3) })
  release()
  await port
  expect(adapter.desktopSettings.getSnapshot().value).toMatchObject({ networkExposure: 'lan', port: 12345 })
})

it('restores persisted state after rejected or cancelled writes and accepts later changes', async () => {
  const { adapter, rejectNext, bridge, state } = fixture()
  await adapter.refresh()
  rejectNext()
  await expect(adapter.notificationSettings.set('enabled', false)).rejects.toThrow('Fixture save failure')
  expect(adapter.notificationSettings.getSnapshot().value?.enabled).toBe(true)
  await adapter.desktopSettings.set('openBrowser', true)
  expect(state.preferences.browserAccess).toBe(true)
  // Native confirmation cancellation resolves without applying the requested value.
  bridge.command = async () => {}
  await adapter.desktopSettings.set('openBrowser', false)
  expect(adapter.desktopSettings.getSnapshot().value?.openBrowser).toBe(true)
  await expect(adapter.desktopSettings.set('__proto__', true)).rejects.toThrow('Unsupported')
})

it('maps only supported features and available Profiles to the shared settings API', async () => {
  const { adapter, state, commands } = fixture()
  const view = await adapter.api.read()
  expect(view.profiles.find(item => item.name === 'broken')?.selectable).toBe(false)
  expect(view.profiles.find(item => item.name === 'desktop')?.deletable).toBe(false)
  await expect(adapter.api.selectMarket('dsh-market')).rejects.toThrow('Plugins page')
  expect(commands).toEqual([])
  state.safeMode = true
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot().writable).toBe(false)
  expect(adapter.notificationSettings.getSnapshot().writable).toBe(false)
  expect(adapter.api.selectAa).toBeUndefined()
  expect(projectSettings(state).market.effective).toBe('disabled')
  await adapter.api.selectProfile('work')
  const switched = await adapter.api.read()
  expect(switched.current).toBe('work')
  expect(switched.profiles.find(item => item.name === 'desktop')?.deletable).toBe(false)
})

it('renders full login links and opens or copies the exact selected address', async () => {
  const { state, links, adapter, commands } = fixture()
  state.browserUrl = 'http://127.0.0.1:1234/'
  state.lan = { state: 'ready', actualPort: 5678, addresses: ['192.168.1.20', '10.0.0.20'], caFingerprint: 'fixture', errorCode: null }
  links.localUrl = state.browserUrl + '?token=browser-login'
  links.lanUrls = state.lan.addresses.map(address => `https://${address}:5678/?token=browser-login`)
  expect((await adapter.api.read()).web).toMatchObject({
    localUrl: links.localUrl, lanUrls: links.lanUrls,
    lanCaUrls: state.lan.addresses.map(address => `https://${address}:5678/.well-known/dsh-desktop-ca.crt`),
  })
  for (const url of [links.localUrl, ...links.lanUrls]) {
    await adapter.api.openBrowser!(url)
    await adapter.api.copyBrowser!(url)
  }
  expect(commands).toEqual([links.localUrl, ...links.lanUrls].flatMap(url => [{ type: 'open-browser-url', url }, { type: 'copy-browser-url', url }]))
  expect(adapter.getSnapshot()?.browserUrl).not.toContain('token=')
})

it('owns the new settings stylesheet under Next and removes it on dispose', () => {
  const remove = vi.fn()
  const style = { id: '', dataset: {} as Record<string, string>, textContent: '', remove }
  const appendChild = vi.fn()
  vi.stubGlobal('document', {
    getElementById: () => null,
    createElement: () => style,
    head: { appendChild },
  })
  const dispose = installDesktopSettingsStyles()
  expect(appendChild).toHaveBeenCalledExactlyOnceWith(style)
  expect(style.dataset).toMatchObject({ plugin: 'dsh-desktop-next', pluginCss: 'dsh-desktop-next/desktop-settings' })
  expect(style.textContent).toContain('.dshDesktopSettingsExpander[aria-expanded="true"] svg')
  expect(style.textContent).toContain('button.dshDesktopSettingsSelect')
  dispose()
  expect(remove).toHaveBeenCalledOnce()
})

it('installs Settings left-nav scroll rules using official scrollbar tokens and removes them on dispose', () => {
  const appended: { dataset: Record<string, string>; textContent: string; remove: () => void }[] = []
  let removed = false
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      expect(tag).toBe('style')
      return { dataset: {}, textContent: '', remove: () => { removed = true } }
    },
    head: { append: (node: typeof appended[number]) => { appended.push(node) } },
  })
  const dispose = installWindowStyles()
  expect(appended).toHaveLength(1)
  expect(appended[0]!.dataset.plugin).toBe('dsh-desktop-next/window-controls')
  expect(appended[0]!.textContent).toContain("body [data-shortcut-modal='settings'] > nav > :last-child > *")
  expect(appended[0]!.textContent).toContain('padding-right: calc(10px - var(--dsh-scrollbar-width, 5px))')
  expect(appended[0]!.textContent).toContain('scrollbar-gutter: stable')
  dispose()
  expect(removed).toBe(true)
})
