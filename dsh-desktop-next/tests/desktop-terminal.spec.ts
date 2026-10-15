import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  desktopTerminalStateDirectory,
  openDesktopTerminal,
  type DesktopTerminalOptions,
  type DesktopTerminalSpawn,
} from '../src/desktop-terminal.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-terminal-'))
  temporaryDirectories.push(dir)
  return dir
}

interface SpawnHarness {
  child: ChildProcess
  unref: ReturnType<typeof vi.fn>
  emitError: (cause: Error) => void
  emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void
  spawn: DesktopTerminalSpawn
  calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }>
}

function spawnHarness(): SpawnHarness {
  const calls: SpawnHarness['calls'] = []
  const unref = vi.fn()
  const emitter = new EventEmitter()
  const child = Object.assign(emitter, { unref }) as unknown as ChildProcess
  const spawn: DesktopTerminalSpawn = (command, args, options) => {
    calls.push({ command, args, options })
    return child
  }
  return {
    child,
    unref,
    spawn,
    calls,
    emitError: cause => { emitter.emit('error', cause) },
    emitExit: (code, signal = null) => { emitter.emit('exit', code, signal) },
  }
}

function windowsOptions(stateDir: string, spawn: DesktopTerminalSpawn): DesktopTerminalOptions {
  return {
    platform: 'win32',
    appExecutable: 'C:\\Program Files\\DSH 100% Desktop\\DSH Desktop.exe',
    dshBootstrapPath: 'C:\\Program Files\\DSH Desktop\\resources\\app.asar\\lib\\dsh-terminal-bootstrap.js',
    pnpmBinPath: 'C:\\Program Files\\DSH Desktop\\resources\\app.asar\\node_modules\\pnpm\\bin\\pnpm.mjs',
    electronVersion: '43.4.0',
    profileName: 'desktop',
    productVersion: '2.0.0',
    profileDir: "C:\\Users\\Example\\DSH O'Brien\\profiles\\desktop",
    homeDir: "C:\\Users\\Example\\DSH O'Brien",
    stateDir,
    spawn,
    environment: {
      Path: 'C:\\Windows\\System32;C:\\Windows',
      ELECTRON_RUN_AS_NODE: 'inherited-node-mode',
      dsh_home: 'C:\\inherited',
      SystemRoot: 'C:\\Windows',
    },
    windowsExecutableResolver: command => command === 'powershell.exe'
      ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      : command === 'cmd.exe'
        ? 'C:\\Windows\\System32\\cmd.exe'
        : undefined,
  }
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('desktop terminal environment', () => {
  it('keeps generated shims isolated by active profile', () => {
    const desktop = desktopTerminalStateDirectory('/tmp/dsh-desktop', 'desktop')
    const work = desktopTerminalStateDirectory('/tmp/dsh-desktop', 'work-profile')

    expect(dirname(desktop)).toBe(join('/tmp/dsh-desktop', 'cli'))
    expect(dirname(work)).toBe(join('/tmp/dsh-desktop', 'cli'))
    expect(basename(desktop)).toMatch(/^[a-f0-9]{64}$/u)
    expect(basename(work)).toMatch(/^[a-f0-9]{64}$/u)
    expect(work).not.toBe(desktop)
    expect(desktopTerminalStateDirectory('/tmp/dsh-desktop', 'desktop')).toBe(desktop)
  })

  it('generates Windows batch shims and opens PowerShell through a visible-console broker', () => {
    const stateDir = join(temporaryDirectory(), 'terminal-state')
    const harness = spawnHarness()
    const options = windowsOptions(stateDir, harness.spawn)

    const launch = openDesktopTerminal(options)

    expect(readFileSync(launch.dshShimPath, 'utf8')).toContain([
      '@echo off',
      'setlocal DisableDelayedExpansion',
      'set "ELECTRON_RUN_AS_NODE=1"',
      '"%DSH_DESKTOP_APP_EXECUTABLE%" --expose-internals "%DSH_DESKTOP_DSH_BOOTSTRAP%"',
    ].join('\r\n'))
    const pnpmShim = readFileSync(launch.pnpmShimPath, 'utf8')
    expect(pnpmShim).toContain('set "npm_config_runtime=electron"')
    expect(pnpmShim).toContain('set "npm_config_target=%DSH_DESKTOP_ELECTRON_VERSION%"')
    expect(pnpmShim).toContain('set "npm_config_disturl=https://electronjs.org/headers"')
    expect(pnpmShim.match(/--config\.minimumReleaseAge=0/gu)).toHaveLength(1)
    expect(pnpmShim).toContain('--config.minimumReleaseAge=0 %*')
    expect(readFileSync(launch.nodeShimPath, 'utf8')).toContain(
      '"%DSH_DESKTOP_APP_EXECUTABLE%" %*',
    )
    const welcome = readFileSync(launch.welcomePath, 'utf8')
    expect(welcome).toContain('Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue')
    expect(welcome).toContain('Set-Location -LiteralPath $env:DSH_DESKTOP_PROFILE_DIRECTORY')
    expect(welcome).toContain('"DSH Desktop {0} terminal" -f $env:DSH_DESKTOP_PRODUCT_VERSION')
    expect(welcome).toContain('"Plugin commands without --profile modify the {0} profile."')
    expect(welcome).toContain('dsh --dump-config')
    expect(welcome).toContain('dsh plugin add <third-party-plugin>')
    expect(welcome).toContain('dsh plugin remove <third-party-plugin>')
    expect(welcome).toContain('dsh plugin update')
    expect(welcome).toContain('Restart DSH Desktop after plugin changes.')

    expect(launch.windowsLauncherPath).toBe(join(stateDir, 'launch.cmd'))
    const launcher = readFileSync(launch.windowsLauncherPath!, 'utf8')
    expect(launcher).toContain('start "DSH NEXT" /D "!DSH_DESKTOP_PROFILE_DIRECTORY!"')
    expect(launcher).toContain('"!DSH_DESKTOP_SHELL_EXECUTABLE!" -NoLogo -NoExit')
    expect(launcher).toContain('-File "!DSH_DESKTOP_POWERSHELL_WELCOME!"')

    expect(harness.calls).toEqual([{
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/D',
        '/S',
        '/C',
        'launch.cmd',
      ],
      options: {
        cwd: stateDir,
        detached: false,
        env: {
          SystemRoot: 'C:\\Windows',
          PATH: `${launch.shimDir};C:\\Windows\\System32;C:\\Windows`,
          DSH_HOME: options.homeDir,
          DSH_DESKTOP_DEFAULT_PROFILE: options.profileName,
          DSH_DESKTOP_APP_EXECUTABLE: options.appExecutable,
          DSH_DESKTOP_DSH_BOOTSTRAP: options.dshBootstrapPath,
          DSH_DESKTOP_ELECTRON_VERSION: options.electronVersion,
          DSH_DESKTOP_PNPM_ENTRY: options.pnpmBinPath,
          DSH_DESKTOP_PROFILE_DIRECTORY: options.profileDir,
          DSH_DESKTOP_PRODUCT_VERSION: options.productVersion,
          DSH_DESKTOP_TERMINAL_MODE: '正常环境 / Normal environment',
          DSH_DESKTOP_SHIM_DIRECTORY: launch.shimDir,
          DSH_DESKTOP_POWERSHELL_WELCOME: launch.welcomePath,
          DSH_DESKTOP_CMD_WELCOME: join(stateDir, 'welcome.cmd'),
          DSH_DESKTOP_SHELL_EXECUTABLE: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        },
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    }])
    expect(harness.unref).toHaveBeenCalledOnce()
  })

  it('opens a new Windows Terminal window when wt.exe is available', () => {
    const stateDir = join(temporaryDirectory(), 'terminal-state')
    const harness = spawnHarness()
    const options = windowsOptions(stateDir, harness.spawn)
    options.windowsExecutableResolver = command => command === 'pwsh.exe'
      ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      : undefined
    options.windowsTerminal = {
      executable: 'C:\\Users\\Example\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
      arguments: [
        '--window',
        'new',
        'new-tab',
        '--title',
        'DSH Desktop',
        '--startingDirectory',
        options.profileDir,
      ],
    }

    const launch = openDesktopTerminal(options)

    expect(harness.calls[0]?.command).toBe(
      'C:\\Users\\Example\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
    )
    expect(harness.calls[0]?.args).toEqual([
      '--window',
      'new',
      'new-tab',
      '--title',
      'DSH Desktop',
      '--startingDirectory',
      options.profileDir,
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      '-NoLogo',
      '-NoExit',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      launch.welcomePath,
    ])
    expect(harness.calls[0]?.options.shell).toBe(false)
  })

  it('falls back to a quoted command prompt welcome when PowerShell is unavailable', () => {
    const stateDir = join(temporaryDirectory(), 'terminal-state')
    const harness = spawnHarness()
    const options = windowsOptions(stateDir, harness.spawn)
    options.profileDir = 'C:\\Users\\Example\\DSH & Tools\\profiles\\desktop'
    options.homeDir = 'C:\\Users\\Example\\DSH & Tools'
    options.windowsExecutableResolver = command => command === 'cmd.exe'
      ? 'C:\\Windows\\System32\\cmd.exe'
      : undefined

    const launch = openDesktopTerminal(options)

    expect(harness.calls[0]?.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(harness.calls[0]?.args).toEqual([
      '/D',
      '/S',
      '/C',
      'launch.cmd',
    ])
    expect(harness.calls[0]?.options.shell).toBe(false)
    const welcome = readFileSync(join(stateDir, 'welcome.cmd'), 'utf8')
    expect(welcome).toContain('setlocal EnableDelayedExpansion')
    expect(welcome).toContain('set "ELECTRON_RUN_AS_NODE="')
    expect(welcome).toContain('cd /d "!DSH_DESKTOP_PROFILE_DIRECTORY!"')
    expect(welcome).toContain('echo(Profile directory: !DSH_DESKTOP_PROFILE_DIRECTORY!')
    const launcher = readFileSync(launch.windowsLauncherPath!, 'utf8')
    expect(launcher).toContain('"!DSH_DESKTOP_SHELL_EXECUTABLE!" /D /K call')
    expect(launcher).toContain('"!DSH_DESKTOP_CMD_WELCOME!"')
  })

  it('prefers pwsh and reports broker errors and unsuccessful exits', () => {
    const stateDir = join(temporaryDirectory(), 'terminal-state')
    const harness = spawnHarness()
    const commands: string[] = []
    const onLaunchError = vi.fn()
    const options = windowsOptions(stateDir, harness.spawn)
    options.windowsExecutableResolver = (command) => {
      commands.push(command)
      if (command === 'pwsh.exe') return 'C:\\PowerShell\\pwsh.exe'
      if (command === 'cmd.exe') return 'C:\\Windows\\System32\\cmd.exe'
      return undefined
    }
    options.onLaunchError = onLaunchError

    openDesktopTerminal(options)
    const cause = new Error('launcher unavailable')
    expect(() => { harness.emitError(cause) }).not.toThrow()

    expect(commands).toEqual(['pwsh.exe', 'cmd.exe'])
    expect(harness.calls[0]?.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(onLaunchError).toHaveBeenCalledWith(cause)

    harness.emitExit(1)
    expect(onLaunchError).toHaveBeenCalledOnce()

    const exitHarness = spawnHarness()
    const exitReporter = vi.fn()
    const exitOptions = windowsOptions(join(temporaryDirectory(), 'terminal-state'), exitHarness.spawn)
    exitOptions.windowsExecutableResolver = options.windowsExecutableResolver
    exitOptions.onLaunchError = exitReporter
    openDesktopTerminal(exitOptions)
    exitHarness.emitExit(1)
    expect(exitReporter).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'terminal launcher exited with code 1' }),
    )
    exitHarness.emitError(new Error('late error'))
    expect(exitReporter).toHaveBeenCalledOnce()
  })

  it('does not trust the Windows Terminal app execution alias without an explicit adapter', () => {
    const stateDir = join(temporaryDirectory(), 'terminal-state')
    const harness = spawnHarness()
    const probes: string[] = []
    const options = windowsOptions(stateDir, harness.spawn)
    delete options.windowsExecutableResolver
    options.environment = {
      ...options.environment,
      LocalAppData: 'C:\\Users\\Example\\AppData\\Local',
    }
    options.windowsExecutableExists = (filename) => {
      probes.push(filename)
      return filename === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        || filename === 'C:\\Windows\\System32\\cmd.exe'
        || filename === 'C:\\Users\\Example\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
    }

    openDesktopTerminal(options)

    expect(probes).toContain('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(probes).not.toContain('C:\\Users\\Example\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe')
    expect(harness.calls[0]?.command).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    )
    expect(harness.calls[0]?.options.shell).toBe(false)
  })

  it('keeps Windows scripts ASCII and passes localized paths through the child environment', () => {
    const stateDir = join(temporaryDirectory(), '终端 state')
    const harness = spawnHarness()
    const options = windowsOptions(stateDir, harness.spawn)
    options.profileName = 'work-profile'
    options.profileDir = 'C:\\用户\\工作 profile'
    options.homeDir = 'C:\\用户'
    options.appExecutable = 'C:\\程序\\DSH Desktop.exe'
    options.dshBootstrapPath = 'C:\\程序\\resources\\app.asar\\lib\\desktop-cli.js'
    options.pnpmBinPath = 'C:\\程序\\resources\\app.asar.unpacked\\node_modules\\pnpm\\bin\\pnpm.mjs'

    const launch = openDesktopTerminal(options)

    const launcherPath = launch.windowsLauncherPath
    expect(launcherPath).toBe(join(stateDir, 'launch.cmd'))
    for (const filename of [
      launch.dshShimPath,
      launch.pnpmShimPath,
      launch.nodeShimPath,
      launch.welcomePath,
      join(stateDir, 'welcome.cmd'),
      launcherPath!,
    ]) {
      expect(readFileSync(filename, 'utf8')).toMatch(/^[\x00-\x7F]*$/u)
    }
    expect(harness.calls[0]?.options.cwd).toBe(stateDir)
    expect(harness.calls[0]?.options.env).toEqual(expect.objectContaining({
      DSH_HOME: 'C:\\用户',
      DSH_DESKTOP_DEFAULT_PROFILE: 'work-profile',
      DSH_DESKTOP_APP_EXECUTABLE: 'C:\\程序\\DSH Desktop.exe',
      DSH_DESKTOP_DSH_BOOTSTRAP: 'C:\\程序\\resources\\app.asar\\lib\\desktop-cli.js',
      DSH_DESKTOP_ELECTRON_VERSION: '43.4.0',
      DSH_DESKTOP_PNPM_ENTRY: 'C:\\程序\\resources\\app.asar.unpacked\\node_modules\\pnpm\\bin\\pnpm.mjs',
      DSH_DESKTOP_PROFILE_DIRECTORY: 'C:\\用户\\工作 profile',
      DSH_DESKTOP_POWERSHELL_WELCOME: join(stateDir, 'welcome.ps1'),
      DSH_DESKTOP_CMD_WELCOME: join(stateDir, 'welcome.cmd'),
    }))
  })

  it('supports Next Profile names with localized paths and rejects escapes before writing state', () => {
    const root = temporaryDirectory()
    const harness = spawnHarness()
    const unsupported = windowsOptions(join(root, 'unsupported'), harness.spawn)
    unsupported.platform = 'linux'
    expect(() => openDesktopTerminal(unsupported)).toThrow('terminal is unsupported on linux')
    expect(() => lstatSync(unsupported.stateDir)).toThrow()

    const unsafe = windowsOptions(join(root, 'unsafe'), harness.spawn)
    unsafe.profileName = '../desktop'
    expect(() => openDesktopTerminal(unsafe)).toThrow('Profile 名称')
    expect(() => lstatSync(unsafe.stateDir)).toThrow()

    const localized = windowsOptions(join(root, 'localized'), harness.spawn)
    localized.profileName = 'work-profile'
    const launch = openDesktopTerminal(localized)
    expect(readFileSync(launch.welcomePath, 'utf8')).toContain('Profile:')
    // The generated scripts read the profile from the child environment, never from inline text.
    expect(harness.calls[0]?.options.env).toMatchObject({ DSH_DESKTOP_DEFAULT_PROFILE: 'work-profile' })

    const newline = windowsOptions(join(root, 'newline'), harness.spawn)
    newline.productVersion = '2.0.0\ntouch injected'
    expect(() => openDesktopTerminal(newline)).toThrow('must not contain NUL or newlines')
    expect(() => lstatSync(newline.stateDir)).toThrow()
    expect(harness.calls).toHaveLength(1)
  })
})


it.each(['safe', 'recovery'] as const)('labels the Windows %s terminal for both PowerShell and cmd', mode => {
  const harness = spawnHarness()
  const options = { ...windowsOptions(join(temporaryDirectory(), 'cli'), harness.spawn), mode }
  const launch = openDesktopTerminal(options)
  expect(harness.calls[0]!.options.env?.DSH_DESKTOP_TERMINAL_MODE).toContain(mode === 'safe' ? 'Safe mode: temporary environment' : 'Recovery terminal: original Profile')
  expect(harness.calls[0]!.options.env?.DSH_HOME).toBe(options.homeDir)
  expect(readFileSync(launch.welcomePath, 'utf8')).toContain('Write-Host $env:DSH_DESKTOP_TERMINAL_MODE')
  expect(readFileSync(join(options.stateDir, 'welcome.cmd'), 'utf8')).toContain('echo(!DSH_DESKTOP_TERMINAL_MODE!')
})
