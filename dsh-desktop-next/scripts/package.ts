/** Next entry points reuse the adopted native Windows packaging and credential boundaries. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDirectory } from '../adopted/scripts/package-dir.mjs'
import { createWindowsPackageOptions, packageWindowsInstaller } from '../adopted/scripts/package-win.ts'
import { runNextPackagingCommand } from './packaging-command.ts'
import { expectedNextVersion, nextRuntimeBuildPaths, prepareNextRuntime, smokeNextRuntime, verifyNextRuntimeTree } from './prepare-runtime.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(desktopRoot, '..')
const require = createRequire(import.meta.url)

/**
 * Optional test-only build version for update drills.
 *
 * electron-builder merges `extraMetadata` before packaging, so one value reaches
 * the packaged `package.json` (which the runtime and the updater's bundle check
 * read) and the `${version}` artifact name. That produces an installable release
 * whose version differs from the source tree, without editing any version
 * declaration. Only the two shapes the Next channel accepts are allowed.
 * The bundled interpreter payloads and the prepared archive payload record the
 * same version.
 */
const TEST_BUILD_VERSION = process.env.DSH_NEXT_BUILD_VERSION
if (TEST_BUILD_VERSION !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+-next(?:\.[0-9]+)?$/u.test(TEST_BUILD_VERSION)) {
  throw new Error(`DSH_NEXT_BUILD_VERSION must be x.y.z-next or x.y.z-next.N; received ${TEST_BUILD_VERSION}`)
}
const buildVersion = expectedNextVersion(desktopRoot)

/**
 * Fail loud on a host that cannot produce the Windows x64 product. Next ships a
 * single platform and CPU, so any other host would prepare a payload nothing
 * consumes instead of an artifact.
 */
function assertWindowsPackagingHost(): void {
  if (process.platform !== 'win32') throw new Error(`DSH NEXT packages Windows x64 only; this host is ${process.platform}`)
  if (process.arch !== 'x64') throw new Error(`DSH NEXT packages Windows x64 only; this Node runs ${process.arch}`)
}

const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void => {
  // Windows resolves the CLI path with backslashes.
  const isBuilder = args.includes('electron-builder') || args.some(arg => arg.replaceAll('\\', '/').endsWith('electron-builder/cli.js'))
  // The adopted Windows flow skips electron-builder's dependency rebuild with npmRebuild=false.
  // electron-builder honours that flag before it calls beforeBuild, and only a beforeBuild answer
  // makes it leave node_modules to the prepared payload, so Next drops the flag: its beforeBuild
  // hook declines the rebuild too.
  const withoutRebuildFlag = isBuilder ? args.filter(arg => arg !== '--config.npmRebuild=false') : args
  const forwarded = TEST_BUILD_VERSION !== undefined && isBuilder
    ? [...withoutRebuildFlag, `--config.extraMetadata.version=${TEST_BUILD_VERSION}`, `--config.buildVersion=${TEST_BUILD_VERSION}`]
    : withoutRebuildFlag
  if (TEST_BUILD_VERSION !== undefined && isBuilder) console.log(`Packaging with test build version ${TEST_BUILD_VERSION}; source manifests are unchanged.`)
  runNextPackagingCommand(command, forwarded, cwd, env)
}

/**
 * Prepare the Windows x64 interpreter payload, then check and execute the final bytes.
 * electron-builder copies the tree as extra resources.
 */
async function prepareInterpreters(): Promise<void> {
  const root = await prepareNextRuntime({ desktopRoot, platform: process.platform, version: buildVersion })
  verifyNextRuntimeTree(root, process.platform, buildVersion)
  smokeNextRuntime(root, process.platform)
}

/**
 * Materialize and seal the payload electron-builder archives. A separate process keeps the
 * manifest transformer it borrows from electron-builder out of this entry point.
 */
const preparePayload = (): void => {
  const result = spawnSync(process.execPath, [join(desktopRoot, 'scripts', 'prepare-payload.ts'),
    ...(TEST_BUILD_VERSION === undefined ? [] : ['--version', TEST_BUILD_VERSION])], { cwd: desktopRoot, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Next payload preparation exited with ${String(result.status)}`)
}

/**
 * The Windows packaging flow calls this right before electron-builder: the interpreter payloads
 * were prepared before it started and must still verify, and the archive payload is prepared now.
 */
const prepareRuntime = (): void => {
  verifyNextRuntimeTree(nextRuntimeBuildPaths(desktopRoot).runtime, process.platform, buildVersion)
  preparePayload()
}

const mode = process.argv[2]
if (mode === 'dir') {
  assertWindowsPackagingHost()
  await prepareInterpreters()
  prepareRuntime()
  packageDirectory({ cwd: desktopRoot, electronBuilderCli: require.resolve('electron-builder/cli.js'), electronDistPath: join(dirname(require.resolve('electron/package.json')), 'dist') })
} else if (mode === 'win') {
  assertWindowsPackagingHost()
  await prepareInterpreters()
  packageWindowsInstaller({ ...createWindowsPackageOptions(), desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') })
} else throw new Error('Expected dir or win')
