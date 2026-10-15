import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = readFileSync(fileURLToPath(new URL('../adopted/build/installer.nsh', import.meta.url)), 'utf8')

/** One macro body, so an assertion cannot be satisfied by text from a neighbouring macro. */
function macroBody(name: string, source = script): string {
  const body = new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`, 'u').exec(source)?.[1]
  if (body === undefined) throw new Error(`installer.nsh: macro ${name} is missing`)
  return body
}

describe('Windows NSIS running-app handoff', () => {
  it('stops the running application through the orderly Electron handoff before forcing a close', () => {
    expect(script).toContain('!macro customCheckAppRunning')
    expect(script).toContain('--dsh-installer-quit')
    expect(script).toContain('!insertmacro KILL_PROCESS')
    expect(script).not.toContain('nsProcess::KillProcess')
    expect(script).not.toContain('getProcessInfo.nsh')
  })

  it('initializes process paths on every check but declares shared NSIS variables only once', () => {
    const template = readFileSync(new URL('../node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh', import.meta.url), 'utf8')
    const check = macroBody('CHECK_APP_RUNNING', template)
    expect(check).toMatch(/!ifndef DSH_PROCESS_PATHS_DECLARED[\s\S]*Var \/GLOBAL CmdPath[\s\S]*Var \/GLOBAL PowerShellPath[\s\S]*!endif/u)
    const initialize = check.indexOf('StrCpy $PowerShellPath')
    expect(initialize).toBeGreaterThanOrEqual(0)
    expect(check.indexOf('!insertmacro customCheckAppRunning')).toBeGreaterThan(initialize)
    expect(macroBody('IS_POWERSHELL_AVAILABLE', template)).toMatch(/!ifndef DSH_POWERSHELL_STATUS_DECLARED[\s\S]*Var \/GLOBAL IsPowerShellAvailable[\s\S]*!endif/u)
  })

  it('waits for the application inside the install-mode step, before the update can elevate', () => {
    // multiUserUi.nsh calls customInstallMode before it elevates, and installSection.nsh skips
    // CHECK_APP_RUNNING in the elevated inner instance. Waiting only in that later stage would
    // extract over files the running application still holds open, so the handoff has to precede
    // the machine-wide mode decision below it.
    const mode = macroBody('customInstallMode')
    const handoff = mode.indexOf('!insertmacro CHECK_APP_RUNNING')
    expect(mode).not.toContain('!insertmacro customCheckAppRunning')
    const machineMode = mode.indexOf('StrCpy $isForceMachineInstall "1"')
    const currentMode = mode.indexOf('StrCpy $isForceCurrentInstall "1"')
    expect(handoff).toBeGreaterThanOrEqual(0)
    expect(machineMode).toBeGreaterThan(handoff)
    expect(currentMode).toBeGreaterThan(handoff)
    // The elevated mode is only ever forced for an in-app update, never for a first install.
    expect(mode).toContain('${if} ${isUpdated}')
    expect(mode).toContain('!ifndef BUILD_UNINSTALLER')
    // A per-user installation stays the default: machine-wide is selected only when the existing
    // installation is machine-wide and there is no per-user one beside it.
    expect(mode).toContain('${if} $hasPerMachineInstallation == "1"')
    expect(mode).toContain('${andIf} $hasPerUserInstallation == "0"')
  })

  it('skips wizard pages during --updated and auto-relaunches when --force-run completes visibly', () => {
    expect(script).toContain('!macro customInstallMode')
    expect(script).toContain('!macro customInstall')
    const mode = macroBody('customInstallMode')
    expect(mode).toContain('StrCpy $isForceMachineInstall "1"')
    expect(mode).toContain('StrCpy $isForceCurrentInstall "1"')
    const install = macroBody('customInstall')
    expect(install).toContain('${if} ${isUpdated}')
    expect(install).toContain('${andIf} ${isForceRun}')
    expect(install).toContain('${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"')
    expect(install).toContain('!insertmacro quitSuccess')
    // The visible flow is the only one that relaunches; a silent install keeps its old behaviour.
    expect(install).toContain('${andIfNot} ${Silent}')
    // No silent switch is passed to the installer by this file.
    expect(script).not.toMatch(/\/S\b/u)
  })
})
