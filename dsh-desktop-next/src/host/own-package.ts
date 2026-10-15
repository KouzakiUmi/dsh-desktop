/** Resolve this application's published exports when Node cannot discover its manifest inside app.asar. */
import { readFileSync } from 'node:fs'
import { registerHooks, type ModuleHooks } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/**
 * Route the archived application's explicit file/default exports; all other requests use the existing resolver chain.
 * @param runtimeDir - Application package directory.
 * @returns Host-lifetime hook, or undefined for a physical development directory.
 */
export function installOwnPackageResolution(runtimeDir: string): ModuleHooks | undefined {
  if (runtimeArchivePath(runtimeDir) === undefined) return undefined
  const manifest = JSON.parse(readFileSync(join(runtimeDir, 'package.json'), 'utf8')) as {
    name?: string
    exports?: Record<string, string | { types?: string; default?: string }>
  }
  if (typeof manifest.name !== 'string' || !manifest.name || !manifest.exports || typeof manifest.exports !== 'object') {
    throw new Error('Archived application must declare its name and public exports')
  }
  const targets = new Map<string, string>()
  for (const [subpath, exported] of Object.entries(manifest.exports)) {
    const target = typeof exported === 'string' ? exported
      : exported && typeof exported === 'object' && Object.keys(exported).every(key => key === 'types' || key === 'default')
        ? exported.default : undefined
    if ((subpath !== '.' && !subpath.startsWith('./')) || typeof target !== 'string' || !target.startsWith('./')) {
      throw new Error('Archived application exports must use explicit relative file targets')
    }
    const path = resolve(runtimeDir, target)
    const inside = relative(runtimeDir, path)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Application export escapes its package')
    targets.set(subpath === '.' ? manifest.name : manifest.name + subpath.slice(1), pathToFileURL(path).href)
  }
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = targets.get(specifier)
      return url === undefined ? nextResolve(specifier, context) : { url, shortCircuit: true }
    },
  })
}
