/** Native installer handoff with explicit user-visible progress on Windows. */
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

/** Check the installer's product identity and embedded version before handing the update to it. */
export function assertNextWindowsInstaller(info: { ProductName?: unknown; ProductVersion?: unknown }, version: string): void {
  if (info.ProductName !== 'DSH NEXT' || info.ProductVersion !== version) throw new Error('The installer does not match this Next release')
}

export class NextUpdateInstaller {
  private prepared?: { path: string; version: string }
  constructor(private readonly options: { platform: string; executable: string; log(error: unknown): void }) {}
  async prepare(path: string, version: string, _directory: string, signal: AbortSignal): Promise<void> {
    this.prepared = undefined
    if (this.options.platform !== 'win32') throw new Error('Unsupported update platform')
    const script = '$ErrorActionPreference="Stop"; (Get-Item -LiteralPath $env:DSH_UPDATE_INSTALLER).VersionInfo | Select-Object ProductName,ProductVersion | ConvertTo-Json -Compress'
    const info = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { signal, timeout: 30_000, windowsHide: true, env: { ...process.env, DSH_UPDATE_INSTALLER: path }, maxBuffer: 16_384 })
    assertNextWindowsInstaller(JSON.parse(info.stdout.replace(/^\uFEFF/, '')), version)
    this.prepared = { path, version }
  }
  /**
   * The NSIS installer waits for the running application before its outer UAC handoff
   * (`adopted/build/installer.nsh`); this step only requires a verified installer.
   */
  async stage(): Promise<void> {
    if (!this.prepared) throw new Error('No prepared Next update')
  }
  /** Called after the Host and windows have finished shutting down. */
  async launch(): Promise<void> {
    if (this.prepared === undefined) throw new Error('No prepared update installer')
    // Visible in-app update: no `/S`. The installer shows progress and relaunches the
    // updated application through the `--updated --force-run` handoff.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.prepared!.path, ['--updated', '--force-run'], { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
      child.once('error', reject)
      child.once('spawn', () => { child.off('error', reject); child.on('error', this.options.log); child.unref(); resolve() })
    })
  }
}
