/** Cross-check the assembled `app.asar` payload against the prepared tree before signing, without a GUI. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { archivedPayload, auditNextPayload, nextPackagingTarget, PAYLOAD_DIR, verifyArchiveAgainstPrepared, verifyNextPayload, verifyUpdaterManifestShim } from './packaged-payload.ts'
import { expectedNextVersion, verifyNextRuntimeTree } from './prepare-runtime.ts'
import { DESKTOP_RUNTIME_FILE } from '../src/runtime-tree.ts'

interface PackContext {
  appOutDir: string
  electronPlatformName: string
  packager: { projectDir: string; appInfo: { version: string } }
}

/**
 * Electron Builder's afterPack hook. The archive and its unpacked files are one copy of the
 * installation; the prepared tree with its sealed descriptor is another. The archive must be
 * complete and resolvable, carry nothing the Desktop file policy omits, keep native and
 * shell-executed files unpacked, embed the prepared descriptor byte for byte, and match its
 * inventory exactly; the interpreter payload copied as extra resources must declare the Windows
 * x64 target and the product version, and no unpacked application directory may sit beside the
 * archive.
 * @param context - Electron Builder's afterPack context.
 */
export default async function afterPack(context: PackContext): Promise<void> {
  const resources = join(context.appOutDir, 'resources')
  if (!existsSync(join(resources, 'app.asar'))) throw new Error('Next must package its application into app.asar like upstream Desktop')
  const target = nextPackagingTarget(context.electronPlatformName as NodeJS.Platform)
  const source = archivedPayload(resources)
  try {
    verifyUpdaterManifestShim(resources)
    verifyNextPayload(source)
    const problems = auditNextPayload(source, target)
    if (problems.length > 0) throw new Error(`Next payload audit failed:\n${problems.join('\n')}`)
    const prepared = join(context.packager.projectDir, ...PAYLOAD_DIR.split('/'), DESKTOP_RUNTIME_FILE)
    const { descriptor } = verifyArchiveAgainstPrepared(source, prepared, context.packager.appInfo.version, target)
    const unpacked = source.list().filter(entry => entry.unpacked).length
    const { release } = descriptor
    console.log(`Verified the archive against the prepared Next payload: ${String(descriptor.files.length)} files (${String(unpacked)} unpacked) for ${descriptor.platform} ${descriptor.archs.join('/')}; `
      + `DSH NEXT ${release.version}, dsh ${release.dshVersion}, Electron ${release.electronVersion}, pnpm ${release.pnpmVersion}`)
  } finally { source.close() }
  const runtimes = verifyNextRuntimeTree(join(resources, 'runtime'), target.platform, expectedNextVersion(context.packager.projectDir))
  for (const runtime of runtimes) console.log(`Verified the ${runtime.arch} primary runtime: Python ${runtime.manifest.python}, Node ${runtime.manifest.node}, pnpm ${runtime.manifest.pnpm}`)
  await Promise.resolve()
}
