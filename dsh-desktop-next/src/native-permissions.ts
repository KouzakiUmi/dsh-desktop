/** OS permission policy kept independent of Electron for headless validation. */
import { desktopPermission, type DesktopPermission, type DesktopPermissionSnapshot, type DesktopPermissionStatus } from './permissions.ts'

export interface PermissionPlatform {
  readonly platform: string
  status(permission: DesktopPermission): DesktopPermissionStatus
  microphone(): Promise<boolean>
  screen(): Promise<void>
  accessibility(): Promise<void>
  openSettings(url: string): Promise<void>
}

export class NativePermissions {
  private readonly pending = new Map<DesktopPermission, Promise<DesktopPermissionSnapshot>>()
  constructor(private readonly native: PermissionPlatform) {}

  query(value: unknown): DesktopPermissionSnapshot {
    const permission = desktopPermission(value)
    const status = this.native.status(permission)
    return { permission, status,
      // Windows grants microphone, screen capture and Accessibility control through its own
      // privacy settings. The application cannot prompt for them in-process, so the dialog only
      // reports the current status and links to the settings page.
      canRequest: false,
      canOpenSettings: this.settingsUrl(permission) !== undefined,
    }
  }

  request(value: unknown): Promise<DesktopPermissionSnapshot> {
    const permission = desktopPermission(value)
    const pending = this.pending.get(permission)
    if (pending) return pending
    const current = this.query(permission)
    if (!current.canRequest) return Promise.resolve(current)
    const request = (async () => {
      if (permission === 'microphone') await this.native.microphone()
      else if (permission === 'screen') await this.native.screen()
      else await this.native.accessibility()
      return this.query(permission)
    })().finally(() => this.pending.delete(permission))
    this.pending.set(permission, request)
    return request
  }

  async openSettings(value: unknown): Promise<void> {
    const url = this.settingsUrl(desktopPermission(value))
    if (!url) throw new Error('This platform has no Desktop permission settings shortcut')
    await this.native.openSettings(url)
  }

  private settingsUrl(permission: DesktopPermission): string | undefined {
    return permission === 'microphone' ? 'ms-settings:privacy-microphone' : undefined
  }
}
