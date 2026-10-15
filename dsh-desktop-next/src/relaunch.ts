/** Explicit launch modes survive a native relaunch without leaking into later restarts. */
export const RECOVERY_ARGUMENT = '--next-recovery'
export const SAFE_ARGUMENT = '--next-safe-mode'
export const ONBOARDING_ARGUMENT = '--next-onboarding'

export function relaunchArguments(argv: readonly string[], recovery: boolean, safe: boolean, onboarding = false): string[] {
  return [...argv.filter(value => value !== RECOVERY_ARGUMENT && value !== SAFE_ARGUMENT && value !== ONBOARDING_ARGUMENT),
    ...recovery ? [RECOVERY_ARGUMENT] : safe ? [SAFE_ARGUMENT] : onboarding ? [ONBOARDING_ARGUMENT] : []]
}

/**
 * Schedule a new app process with `args` once this one exits.
 *
 * Electron's own relauncher is the only mechanism this product needs: the installed executable
 * stays in place across an in-app update, so there is no extracted or mounted runtime to re-enter
 * and no image path to hand to a detached shell.
 * @param app - Electron application object.
 * @param args - Arguments the new process starts with.
 */
export function relaunchApp(app: { relaunch(options: { args: string[] }): void }, args: readonly string[]): void {
  app.relaunch({ args: [...args] })
}
