import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { zipSync } from 'fflate'
import { expect, it } from 'vitest'
import {
  assertRegularZipEntry, downloadPrimaryRuntimeAsset, parsePrimaryRuntimeLock, prepareOfficeSkillAssets, primaryRuntimePayloadDigest,
  readPrimaryRuntimeLock, smokePrimaryRuntime, unpackPrimaryRuntimeWheel, type PrimaryRuntimeLock,
} from '../scripts/primary-runtime.ts'

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> }
const lock = readPrimaryRuntimeLock()
const mutableLock = (): Mutable<PrimaryRuntimeLock> => structuredClone(lock) as Mutable<PrimaryRuntimeLock>

const libraryWheel = Buffer.from('UEsDBAoAAAAAAASeLl0sYMPjDAAAAAwAAAAJAAAAc2FtcGxlLnB5c2FtcGxlID0gNDIKUEsBAh4DCgAAAAAABJ4uXSxgw+MMAAAADAAAAAkAAAAAAAAAAQAAAKSBAAAAAHNhbXBsZS5weVBLBQYAAAAAAQABADcAAAAzAAAAAAA=', 'base64')
const relocatedWheel = Buffer.from('UEsDBAoAAAAAAASeLl3x0Nj9FAAAABQAAAAeAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlcmVxdWlyZXMgcmVsb2NhdGlvbgpQSwECHgMKAAAAAAAEni5d8dDY/RQAAAAUAAAAHgAAAAAAAAABAAAApIEAAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlUEsFBgAAAAABAAEATAAAAFAAAAAAAA==', 'base64')
const externalLibraryWheel = Buffer.from('UEsDBBQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAc2FtcGxlLTEuMC5kYXRhL3B1cmVsaWIvc2FtcGxlLnB5cmVxdWlyZXMgbGlicmFyeSByZWxvY2F0aW9uClBLAQIUAxQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAAAAAAAAAAACAAQAAAABzYW1wbGUtMS4wLmRhdGEvcHVyZWxpYi9zYW1wbGUucHlQSwUGAAAAAAEAAQBPAAAAWwAAAAAA', 'base64')

it('pins the Windows target Next packages and the distributions the Office smoke imports', () => {
  expect(lock.targets['win-x64'].wheels.length).toBeGreaterThan(0)
  for (const name of ['numpy', 'pandas', 'python-docx', 'python-pptx', 'openpyxl', 'Pillow', 'lxml', 'XlsxWriter']) expect(lock.pythonPackages).toHaveProperty(name)
})

it('rejects a lock missing the pinned Windows target or carrying a malformed digest', () => {
  const missing = mutableLock()
  Reflect.deleteProperty(missing.targets, 'win-x64')
  expect(() => parsePrimaryRuntimeLock(missing)).toThrow('malformed target win-x64')
  const corrupt = mutableLock()
  corrupt.targets['win-x64'].pythonSha256 = 'not a digest'
  expect(() => parsePrimaryRuntimeLock(corrupt)).toThrow('malformed target win-x64')
  const versions = mutableLock()
  versions.pythonRelease = 'latest'
  expect(() => parsePrimaryRuntimeLock(versions)).toThrow('malformed interpreter versions')
})

it.each(Object.entries(lock.targets))('records every locked wheel distribution and version for %s', (_target, artifact) => {
  const normalize = (name: string): string => name.toLowerCase().replace(/[-_.]+/gu, '-')
  const distributions = [...artifact.wheels, ...lock.wheels].map(({ url }) => {
    const [name, version] = basename(new URL(url).pathname).split('-')
    return [normalize(name!), version] as const
  })
  const declared = Object.entries(lock.pythonPackages).map(([name, version]) => [normalize(name), version] as const)
  expect(new Set(distributions.map(([name]) => name)).size).toBe(distributions.length)
  expect(new Set(declared.map(([name]) => name)).size).toBe(declared.length)
  expect(Object.fromEntries(distributions)).toEqual(Object.fromEntries(declared))
})

it('keeps the payload identity tied to the locked archives of the Windows target', () => {
  const changed = mutableLock()
  changed.targets['win-x64'].wheels[0]!.sha256 = 'a'.repeat(64)
  expect(primaryRuntimePayloadDigest('win-x64', changed, '11.7.0')).not.toBe(primaryRuntimePayloadDigest('win-x64', lock, '11.7.0'))
})

it('invalidates payload identity for shared wheels, package versions and package-manager changes', () => {
  const wheel = mutableLock(), distribution = mutableLock()
  wheel.wheels[0]!.sha256 = 'a'.repeat(64)
  distribution.pythonPackages['python-docx'] = '1.2.1'
  const original = primaryRuntimePayloadDigest('win-x64', lock, '11.7.0')
  expect(primaryRuntimePayloadDigest('win-x64', wheel, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('win-x64', distribution, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('win-x64', lock, '11.7.1')).not.toBe(original)
})

it('reports missing distribution metadata before trying to execute a stale native payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-stale-runtime-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      components: { python: '3.12.14', numpy: '2.3.5', pandas: '3.0.1' } }))
    expect(() => { smokePrimaryRuntime(root) }).toThrow('missing Python distribution versions; prepare the payload')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('reports a payload of another platform or CPU as not executed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-foreign-runtime-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform === 'win32' ? 'darwin' : 'win32', arch: 'x64',
      python: '3.12.14', node: '24.21.0', pnpm: '11.8.0', pythonPackages: { numpy: '2.3.5' } }))
    expect(smokePrimaryRuntime(root)).toBe(false)
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform, arch: process.arch === 'x64' ? 'arm64' : 'x64',
      python: '3.12.14', node: '24.21.0', pnpm: '11.8.0', pythonPackages: { numpy: '2.3.5' } }))
    expect(smokePrimaryRuntime(root)).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('extracts a hash-verified cached library without a Python installer or network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const hash = createHash('sha256').update(libraryWheel).digest('hex')
    const archive = join(root, hash)
    await writeFile(archive, libraryWheel)
    const original = await stat(archive)
    expect(await downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).toBe(archive)
    const reused = await stat(archive)
    expect(reused.ino).toBe(original.ino)
    expect(reused.mtimeMs).toBe(original.mtimeMs)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample.py'), 'utf8')).toBe('sample = 42\n')
    await writeFile(archive, 'corrupt archive')
    await expect(downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).rejects.toThrow('checksum mismatch')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('fully extracts a large deflate-compressed wheel entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-large-wheel-'))
  try {
    const expected = Buffer.alloc(1024 * 1024)
    // Seeded xorshift bytes keep the compressed entry larger than the stream buffers.
    let state = 26
    for (let index = 0; index < expected.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      expected[index] = state & 255
    }
    const archive = join(root, 'large.whl')
    await writeFile(archive, zipSync({ 'large.bin': expected }, { level: 6 }))
    await unpackPrimaryRuntimeWheel(archive, root)
    // Native byte equality avoids a per-byte matcher traversal for this 1 MiB expected output.
    expect((await readFile(join(root, 'large.bin'))).equals(expected)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains auxiliary wheel scripts without generating command wrappers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, relocatedWheel)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample-1.0.data/scripts/sample'), 'utf8')).toBe('requires relocation\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects library files requiring an unsupported installation scheme', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, externalLibraryWheel)
    await expect(unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))).rejects.toThrow('unsupported installation paths')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('copies complete Office resources outside the application archive and removes obsolete assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-assets-'))
  try {
    const source = join(root, 'package', 'assets')
    const destination = join(root, 'Contents', 'Resources', 'runtime', 'x64', 'office-skills')
    for (const name of ['office', 'office-docx', 'office-export-pdf', 'office-pptx', 'office-recalculate', 'office-render', 'office-xlsx']) {
      await mkdir(join(source, name), { recursive: true })
      await writeFile(join(source, name, 'SKILL.md'), `# ${name}\n`)
    }
    await prepareOfficeSkillAssets(source, destination)
    await writeFile(join(destination, 'obsolete.py'), 'old helper')
    await prepareOfficeSkillAssets(source, destination)
    for (const name of ['office', 'office-docx', 'office-export-pdf', 'office-pptx', 'office-recalculate', 'office-render', 'office-xlsx']) {
      expect(await readFile(join(destination, name, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`)
    }
    await expect(readFile(join(destination, 'obsolete.py'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('refuses a zip entry that is not a plain file or directory', () => {
  // The Unix mode lives in the high half of the external attributes; 0o120777 is a symbolic link.
  expect(() => assertRegularZipEntry({ fileName: 'link', externalFileAttributes: (0o120777 << 16) >>> 0 })).toThrow('symbolic link')
  expect(() => assertRegularZipEntry({ fileName: 'dev', externalFileAttributes: (0o020666 << 16) >>> 0 })).toThrow('unsupported type')
  expect(() => assertRegularZipEntry({ fileName: 'file', externalFileAttributes: (0o100644 << 16) >>> 0 })).not.toThrow()
  expect(() => assertRegularZipEntry({ fileName: 'dir/', externalFileAttributes: (0o040755 << 16) >>> 0 })).not.toThrow()
  // A Windows-created archive records no Unix mode at all.
  expect(() => assertRegularZipEntry({ fileName: 'file.txt', externalFileAttributes: 0 })).not.toThrow()
})
