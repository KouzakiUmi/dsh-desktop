/** Verify the committed application icon resources; regenerate the Windows ICO on any build host. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/** Channels that commit icon resources. Next is the only product this repository ships. */
export const ICON_PACKAGES = Object.freeze({ next: 'dsh-desktop-next' })

/**
 * Files the Windows package consumes. The layered Icon Composer document is the source of record;
 * macOS renders `app-icon.png` from it, and every host derives the multi-size `app-icon.ico`.
 */
export const ICON_OUTPUTS = Object.freeze(['app-icon.png', 'app-icon.ico'])

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** Include every vector layer, not just icon.json, when detecting stale exports. */
export function iconSourceDigest(directory) {
  const digest = createHash('sha256')
  function visit(relative) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.')) continue
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) digest.update(path).update('\0').update(readFileSync(join(directory, path))).update('\0')
    }
  }
  visit('')
  return digest.digest('hex')
}

/**
 * Fail on source edits or missing/modified committed exports on any build host.
 * @param {string} buildDirectory - Package build directory holding the icon record.
 * @returns {void}
 */
export function checkIconResources(buildDirectory) {
  const record = JSON.parse(readFileSync(join(buildDirectory, 'app-icon.resources.json'), 'utf8'))
  const stale = () => {
    throw new Error(`${buildDirectory}: icon resources are stale; render the committed PNG from the Icon Composer source on macOS and run corepack yarn icons:export`)
  }
  if (record.source !== 'app-icon.icon' || record.sourceSha256 !== iconSourceDigest(join(buildDirectory, 'app-icon.icon'))) stale()
  for (const name of ICON_OUTPUTS) {
    if (!existsSync(join(buildDirectory, name)) || record.outputs?.[name] !== hash(readFileSync(join(buildDirectory, name)))) stale()
  }
}

/** Re-record the layered source digest and every committed Windows export. */
function writeIconRecord(buildDirectory) {
  const record = JSON.parse(readFileSync(join(buildDirectory, 'app-icon.resources.json'), 'utf8'))
  writeFileSync(join(buildDirectory, 'app-icon.resources.json'), `${JSON.stringify({
    ...record,
    source: 'app-icon.icon',
    sourceSha256: iconSourceDigest(join(buildDirectory, 'app-icon.icon')),
    outputs: Object.fromEntries(ICON_OUTPUTS.map(name => [name, hash(readFileSync(join(buildDirectory, name)))])),
  }, null, 2)}\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const requested = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : 'next'
  if (!Object.hasOwn(ICON_PACKAGES, requested)) throw new Error('Use --channel next')
  const build = join(root, ICON_PACKAGES[requested], 'build')
  if (args.includes('--check')) {
    checkIconResources(build)
    console.log(`icons: ${requested} layered source and every committed Windows export match`)
    return
  }
  // The layered document renders through Icon Composer on macOS; every other host rebuilds the
  // Windows ICO from the committed 1024px PNG, which is the artwork the application ships.
  const { generateWindowsAppIcon } = await import(`../${ICON_PACKAGES[requested]}/scripts/generate-windows-app-icon.mjs`)
  await generateWindowsAppIcon(join(build, 'app-icon.png'), join(build, 'app-icon.ico'))
  writeIconRecord(build)
  checkIconResources(build)
  console.log(`icons: ${requested} regenerated app-icon.ico from the committed artwork and re-recorded its digest`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
