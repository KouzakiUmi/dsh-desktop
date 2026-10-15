import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'
import { afterEach, expect, it } from 'vitest'
import { archivedPayload, auditNextPayload, nextPackagingTarget, nextPayloadRelease, verifyArchiveAgainstPrepared, verifyNextPayload, verifyNextRuntime, verifyUpdaterManifestShim } from '../scripts/packaged-payload.ts'
import { DESKTOP_RUNTIME_FILE, physicalPayload, readDesktopRuntime, sealPayload } from '../src/runtime-tree.ts'
import { completeApplication, FIXTURE_RELEASE, FIXTURE_SHARED, writeApplication, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const machO = (body: string): Buffer => Buffer.concat([Buffer.from([0xCF, 0xFA, 0xED, 0xFE]), Buffer.from(body)])
const unix = process.platform !== 'win32'
const target = nextPackagingTarget('win32')
const HELPER_PLIST = 'node_modules/native-pkg/Helper.app/Contents/Info.plist'
/** A nested bundle's Info.plist as its package ships it. */
const PLIST = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>org.example.helper</string>\n\t<key>CFBundleVersion</key>\n\t<string>1.0</string>\n</dict>\n</plist>\n"

/**
 * A prepared Next payload with its sealed descriptor, then the archive Electron Builder assembles
 * from it: two copies of one installation, as the real build produces them.
 */
async function assembled(extra: (app: string) => void = () => {}, seal = true): Promise<{ resources: string; app: string }> {
  const root = mkdtempSync(join(tmpdir(), 'desktop-archived-'))
  roots.push(root)
  const app = join(root, 'payload')
  writeApplication(app)
  completeApplication(app)
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies['native-pkg'] = '*'
  writeFileSync(join(app, 'package.json'), JSON.stringify(manifest) + '\n')
  const native = writePackage(join(app, 'node_modules'), 'native-pkg')
  mkdirSync(join(native, 'bin'))
  writeFileSync(join(native, 'bin', 'uv'), machO('uv'))
  writeFileSync(join(native, 'addon.node'), machO('addon'))
  mkdirSync(join(native, 'Helper.app', 'Contents'), { recursive: true })
  writeFileSync(join(app, ...HELPER_PLIST.split('/')), PLIST)
  if (unix) chmodSync(join(native, 'bin', 'uv'), 0o755)
  extra(app)
  if (seal) sealPayload(physicalPayload(app), join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE, Object.keys(manifest.dependencies), target)
  const resources = join(root, 'Resources')
  mkdirSync(resources)
  await createPackageWithOptions(app, join(resources, 'app.asar'), {
    unpack: '{**/*.node,**/bin/uv}', unpackDir: '{scripts/node-bin,assets,build,node_modules/pnpm,**/Helper.app}',
  })
  return { resources, app }
}

it('describes the one target the product ships and refuses every other platform', () => {
  expect(nextPackagingTarget('win32')).toEqual({ platform: 'win32', archs: ['x64'] })
  expect(() => nextPackagingTarget('darwin')).toThrow(/Windows x64 only/u)
  expect(() => nextPackagingTarget('linux')).toThrow(/Windows x64 only/u)
})

it('requires the bundled stylesheet license without requiring a macOS tray template', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-license-'))
  roots.push(root)
  writeApplication(root)
  completeApplication(root)
  expect(existsSync(join(root, 'assets/tray-iconTemplate.png'))).toBe(false)
  expect(() => verifyNextPayload(physicalPayload(root))).not.toThrow()
  rmSync(join(root, 'assets/licenses/shadcn.txt'))
  expect(() => verifyNextPayload(physicalPayload(root))).toThrow('Missing Next payload: assets/licenses/shadcn.txt')
})

it('reads archive entries from their offsets, unpacked entries from the physical sibling and the embedded descriptor', async () => {
  const { resources, app } = await assembled()
  const source = archivedPayload(resources)
  try {
    const paths = source.list().map(entry => entry.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain('lib/main.js')
    expect(source.entry('lib/main.js')).toMatchObject({ unpacked: false, executable: false })
    expect(source.entry('lib/main.js')!.read().toString('utf8')).toBe('export {}\n')
    expect(source.entry('node_modules/native-pkg/addon.node')).toMatchObject({ unpacked: true })
    expect(source.entry('node_modules/native-pkg/bin/uv')).toMatchObject({ unpacked: true, executable: unix })
    expect(source.entry('scripts/node-bin/node')).toMatchObject({ unpacked: true, executable: unix })
    expect(source.entry('node_modules/pnpm/bin/pnpm.mjs')).toMatchObject({ unpacked: true })
    expect(source.entry('node_modules/@deepseek-ai/dsh/index.js')!.read().toString('utf8')).toBe('export const identity = {}\n')
    // The descriptor rides inside the archive but, as in the prepared tree, stays outside the inventory.
    expect(paths).not.toContain(DESKTOP_RUNTIME_FILE)
    expect(source.entry(DESKTOP_RUNTIME_FILE)).toMatchObject({ unpacked: false })
    expect(source.descriptor()).toEqual(readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE)))
    expect(existsSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'bin', 'uv'))).toBe(true)
    expect(existsSync(join(resources, 'app.asar.unpacked', 'lib', 'main.js'))).toBe(false)
    expect(() => verifyNextPayload(source)).not.toThrow()
    expect(auditNextPayload(source, target)).toEqual([])
    expect(nextPayloadRelease(source, '44.0.0')).toEqual(FIXTURE_RELEASE)
  } finally { source.close() }
  rmSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'addon.node'))
  expect(() => archivedPayload(resources)).toThrow(/no physical file/u)
})

it('reports stray root entries, policy leftovers, packed native code and packed shell-executed files', async () => {
  // A driver for a platform this package never ships: the audit must report both the file-policy
  // omission of the foreign native package and the unpack requirement for it.
  const foreignCua = `@trycua/cua-driver-${target.platform === 'win32' ? 'darwin-arm64' : 'win32-x64'}`
  const { resources } = await assembled((app) => {
    mkdirSync(join(app, '.desktop-next', 'home'), { recursive: true })
    writeFileSync(join(app, '.desktop-next', 'home', 'desktop-next.json'), '{}')
    writeFileSync(join(app, 'README.md'), '# leak\n')
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh', 'index.js.map'), '{}')
    writeFileSync(join(app, 'node_modules', 'native-pkg', 'helper'), machO('helper'))
    mkdirSync(join(app, 'node_modules', '@agents-anywhere', 'dsh-bridge-next', 'lib', 'bundled-connector'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@agents-anywhere', 'dsh-bridge-next', 'lib', 'bundled-connector', 'main.py'), 'print()\n')
    mkdirSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills', 'agent-experience'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills', 'agent-experience', 'SKILL.md'), '---\nname: agent-experience\n---\n')
    mkdirSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-skill-badge', 'assets'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-skill-badge', 'assets', 'dsh-badge.png'), 'png\n')
    mkdirSync(join(app, 'node_modules', ...foreignCua.split('/')), { recursive: true })
    writeFileSync(join(app, 'node_modules', ...foreignCua.split('/'), 'package.json'), `{"name":"${foreignCua}"}\n`)
  })
  const source = archivedPayload(resources)
  try {
    expect(auditNextPayload(source, target)).toEqual([
      '.desktop-next: outside the declared application files',
      'README.md: outside the declared application files',
      'node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/main.py: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh-agent-preset/skills/agent-experience/SKILL.md: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh-skill-badge/assets/dsh-badge.png: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh/index.js.map: source map must not be packaged',
      `node_modules/${foreignCua}/package.json: native package other platform must not be packaged`,
      `node_modules/${foreignCua}/package.json: must be unpacked beside app.asar`,
      'node_modules/native-pkg/helper: native code is packed inside app.asar',
    ])
  } finally { source.close() }
})

it('rejects an archive missing a declared dependency or a shell-owned file', async () => {
  const { resources } = await assembled((app) => {
    rmSync(join(app, 'node_modules', '@deepseek-ai', 'cordis'), { recursive: true })
  }, false)
  const source = archivedPayload(resources)
  try { expect(() => verifyNextPayload(source)).toThrow(/Missing packaged dependency @deepseek-ai\/cordis/u) } finally { source.close() }
  const { resources: without } = await assembled((app) => { rmSync(join(app, 'host.cordis.patch.yml')) }, false)
  const missing = archivedPayload(without)
  try { expect(() => verifyNextPayload(missing)).toThrow(/Missing Next payload: host\.cordis\.patch\.yml/u) } finally { missing.close() }
})

it('cross-checks the archive against the prepared descriptor, then the final application against the embedded copy', async () => {
  const { resources, app } = await assembled()
  const prepared = join(app, DESKTOP_RUNTIME_FILE)
  const sealed = readDesktopRuntime(prepared)
  expect(sealed.sharedPackages.map(entry => entry.name)).toEqual([...FIXTURE_SHARED, '@deepseek-ai/dsh-web-frontend', 'native-pkg'].sort())
  expect(sealed.files.find(file => file.path === 'node_modules/native-pkg/addon.node')).toMatchObject({ machO: true })
  expect(sealed.files.find(file => file.path === 'lib/main.js')).toMatchObject({ machO: false, executable: false })
  const shim = join(resources, 'app.asar.unpacked', 'scripts', 'node-bin', 'node')
  const source = archivedPayload(resources)
  try {
    expect(verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toEqual({ descriptor: sealed })
    expect(() => verifyArchiveAgainstPrepared(source, prepared, '2.0.1-next', target)).toThrow(/not the expected 2\.0\.1-next/u)
    // The archive must carry the prepared descriptor byte for byte, not merely an equivalent one.
    writeFileSync(prepared, JSON.stringify(sealed))
    expect(() => verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toThrow(/differs from the prepared one/u)
    writeFileSync(prepared, `${JSON.stringify(sealed, undefined, 2)}\n`)
    // Any file that differs between the two copies names itself.
    writeFileSync(shim, 'tampered')
    expect(() => verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toThrow(/integrity verification failed: changed scripts\/node-bin\/node/u)
    writeFileSync(shim, 'payload:scripts/node-bin/node\n')
    expect(verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target).descriptor).toEqual(sealed)
  } finally { source.close() }
  // After packaging only the archive remains, and signing has rewritten the unpacked Mach-O file.
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toEqual(sealed)
  writeFileSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'addon.node'), machO('addon, now signed'))
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toThrow(/integrity/u)
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toEqual(sealed)
  expect(() => verifyNextRuntime(resources, '2.0.1-next', target, { afterCodeSigning: true })).toThrow(/not the expected 2\.0\.1-next/u)
  // A changed shell shim is never acceptable.
  writeFileSync(shim, 'tampered')
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toThrow(/changed scripts\/node-bin\/node/u)
})

it('rejects an archive that carries no descriptor', async () => {
  const { resources, app } = await assembled(() => {}, false)
  const source = archivedPayload(resources)
  try {
    expect(() => source.descriptor()).toThrow(/desktop-runtime\.json is missing from the archive/u)
    expect(() => verifyArchiveAgainstPrepared(source, join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE.version, target)).toThrow(/ENOENT/u)
    writeFileSync(join(app, DESKTOP_RUNTIME_FILE), '{}')
    expect(() => verifyArchiveAgainstPrepared(source, join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE.version, target)).toThrow(/missing from the archive/u)
  } finally { source.close() }
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toThrow(/missing from the archive/u)
})

it('refuses to describe a payload whose pnpm has no version', async () => {
  const { resources } = await assembled((app) => { writeFileSync(join(app, 'node_modules', 'pnpm', 'package.json'), '{"name":"pnpm"}') }, false)
  const source = archivedPayload(resources)
  try { expect(() => nextPayloadRelease(source, '44.0.0')).toThrow(/pnpm has no version/u) } finally { source.close() }
})

it('requires that no unpacked application directory sits beside the archive', async () => {
  const { resources, app } = await assembled()
  // Windows loads app.asar and reads the packaged manifest inside it, so nothing may shadow it.
  expect(() => verifyUpdaterManifestShim(resources)).not.toThrow()
  mkdirSync(join(resources, 'app'))
  copyFileSync(join(app, 'package.json'), join(resources, 'app', 'package.json'))
  expect(() => verifyUpdaterManifestShim(resources)).toThrow(/must not ship an unpacked application directory/u)
})
