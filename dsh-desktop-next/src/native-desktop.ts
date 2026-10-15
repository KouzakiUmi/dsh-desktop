/** Electron-only tray, materials, and user-turn notifications. */
import { unpackedPath } from './asar-archive-policy.ts'
import { join } from 'node:path'
import { Menu, nativeImage, nativeTheme, Notification, Tray, type BrowserWindow } from 'electron'
import { desktopMenu } from './desktop-menu.ts'
import { notificationCopy, notificationEnabled } from './notifications.ts'
import type { DesktopCommand, DesktopPreferences, DesktopState, DesktopNotification } from './desktop-contract.ts'
import { windowMaterial } from './window-material.ts'
import { IPC } from './ipc.ts'
import { updateLabel } from './update-state.ts'

export function applyWindowMaterial(window: BrowserWindow, preferences: DesktopPreferences): void {
  const material = windowMaterial(preferences)
  window.setBackgroundColor(material === 'off' ? nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb' : '#00000000')
  window.webContents.send(IPC.material, material)
}

export class NativeDesktop {
  private tray: Tray | undefined
  private readonly notifications = new Set<Notification>()
  constructor(private readonly options: {
    root: string; language(): string; state(): DesktopState; window(): BrowserWindow | undefined
    show(): void; run(command: DesktopCommand): void; warn(error: unknown): void
  }) {}
  get available(): boolean { return !!this.tray && !this.tray.isDestroyed() }
  createTray(): void {
    try {
      const icon = nativeImage.createFromPath(unpackedPath(join(this.options.root, 'assets', 'tray-icon-blue.png')))
      if (icon.isEmpty()) throw new Error('Tray icon is unavailable')
      this.tray = new Tray(icon)
      this.tray.on('click', this.options.show)
      this.tray.on('double-click', this.options.show)
      this.refresh()
    } catch (error) { this.options.warn(error) }
  }
  items() { return desktopMenu(this.options.state(), this.options.language(), this.options.show, this.options.run) }
  refresh(): void {
    if (!this.available) return
    const state = this.options.state()
    this.tray!.setToolTip(`DSH NEXT · ${state.selected} · ${state.phase}${state.updates && state.updates.phase !== 'idle' ? ` · ${updateLabel(state.updates, this.options.language())}` : ''}`)
    this.tray!.setContextMenu(Menu.buildFromTemplate(this.items()))
  }
  notify(message: DesktopNotification): void {
    const state = this.options.state()
    const window = this.options.window()
    if (!Notification.isSupported() || !notificationEnabled(state.preferences, message.outcome) || window?.isFocused()) return
    const notification = new Notification(notificationCopy(message, this.options.language()))
    this.notifications.add(notification)
    notification.once('click', this.options.show)
    notification.once('close', () => this.notifications.delete(notification))
    notification.once('failed', (_event, error) => { this.notifications.delete(notification); this.options.warn(error) })
    notification.show()
    if (this.notifications.size > 10) { const oldest = this.notifications.values().next().value!; oldest.close(); this.notifications.delete(oldest) }
  }
  /**
   * Announce one newly discovered background update. A platform that cannot show notifications
   * opens the download prompt directly, so the discovery is never silent.
   * @param version - Version the service published.
   * @param onSelect - Opens the download prompt once the user reacts to the notification.
   */
  notifyUpdate(version: string, onSelect: () => void): void {
    if (!Notification.isSupported()) { onSelect(); return }
    const zh = this.options.language().toLowerCase().startsWith('zh')
    const notification = new Notification({
      title: 'DSH NEXT',
      body: zh ? `发现新版本 v${version}，点击下载更新。` : `DSH NEXT v${version} is available. Click to download the update.`,
    })
    this.notifications.add(notification)
    notification.once('click', () => { this.options.show(); onSelect() })
    notification.once('close', () => this.notifications.delete(notification))
    notification.once('failed', (_event, error) => { this.notifications.delete(notification); this.options.warn(error) })
    notification.show()
    if (this.notifications.size > 10) { const oldest = this.notifications.values().next().value!; oldest.close(); this.notifications.delete(oldest) }
  }
  close(): void {
    this.tray?.destroy(); this.tray = undefined
    for (const item of this.notifications) item.close()
    this.notifications.clear()
  }
}
