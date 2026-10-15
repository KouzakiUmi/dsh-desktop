/**
 * Resolve the environment a packaged desktop Host launch inherits.
 *
 * The product ships Windows x64 only. A packaged launch comes from Explorer or a Start-menu
 * shortcut and carries the user's own environment; there is no Unix login shell whose startup
 * files could contribute exports the launch is missing, so the update set is always empty and
 * `process.env` is retained as it was captured.
 * @module
 */

/** Environment updates recovered for the desktop Host. */
export interface DesktopShellEnvironmentResolution {
  /** Selected entries to merge into `process.env`; inherited entries are omitted. */
  readonly updates: Readonly<Record<string, string>>
  /** Whether a login shell contributed any updates. */
  readonly source: 'process' | 'login-shell'
  /** Stable diagnostic reason when the inherited process environment was retained. */
  readonly fallbackReason?: 'not-packaged' | 'windows'
}

/** Inputs for {@link resolveDesktopShellEnvironment}. */
export interface ResolveDesktopShellEnvironmentOptions {
  readonly environment: NodeJS.ProcessEnv
  readonly isPackaged: boolean
}

/**
 * Resolve the selected exports for a desktop Host launch.
 * @param options - Launch environment and packaging state.
 * @returns An empty update set; the inherited process environment is retained.
 */
export async function resolveDesktopShellEnvironment(
  options: ResolveDesktopShellEnvironmentOptions,
): Promise<DesktopShellEnvironmentResolution> {
  return {
    updates: {},
    source: 'process',
    fallbackReason: options.isPackaged ? 'windows' : 'not-packaged',
  }
}
