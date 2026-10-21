import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
it('declares every official optional bundle as a discoverable, version-aligned installation dependency', () => {
  const next = read('../package.json')
  const require = createRequire(new URL('../package.json', import.meta.url))
  for (const name of OPTIONAL_BUNDLES) {
    expect(next.dependencies[name], name).toBe(next.dependencies['@deepseek-ai/dsh-app-boot'])
    const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
    expect(installed.version, name).toBe(next.dependencies[name])
    expect(installed.dsh?.bundle?.patch, name).toBeTruthy()
  }
})

it('packages Windows x64 only while keeping fuses and native inventory aligned with the adopted Windows flow', () => {
  const next = read('../package.json')
  expect(next.version).toBe('2.0.19-next')
  expect(next.build.appId).toBe('ai.deepseek.dsh.desktop.next')
  expect(next.build.asar).toBe(true)
  // The only writable production targets are Windows x64; macOS, Linux and DMG carry no configuration.
  for (const platform of ['mac', 'linux', 'dmg']) expect(next.build[platform], platform).toBeUndefined()
  expect(next.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
  // Electron's own fs and dlopen read the archive; child processes, shells and nativeImage need these physically.
  expect(next.build.asarUnpack).toEqual(expect.arrayContaining(['**/*.{node,dll,exe}',
    '**/@vscode/ripgrep-*/bin/rg', '**/@dataiku/uv-*/bin/uv', '**/meshcall-router-*/bin/*', '**/node_modules/@deepseek-ai/libreoffice-kit-*/**/*', '**/node_modules/pnpm/**/*',
    '**/node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/**/*', '**/node_modules/@deepseek-ai/dsh-agent-preset/**/*',
    '**/node_modules/@deepseek-ai/dsh-skill-badge/**/*']))
  // The prepared tree is archived verbatim, as upstream archives its prepared dsh tree: one file set for the
  // shell files and one for the dependency tree, because electron-builder leaves out a file set's root node_modules.
  expect(next.build.files).toEqual([{ from: '.desktop-build/payload', filter: ['**/*'] },
    { from: '.desktop-build/payload/node_modules', to: 'node_modules', filter: ['**/*'] }])
  expect(next.build.win.files).toBeUndefined()
  // electron-builder collects node_modules itself unless beforeBuild declines, and npmRebuild: false would skip that hook.
  expect(next.build.beforeBuild).toBe('./scripts/before-build.ts')
  expect(next.build.npmRebuild).toBeUndefined()
  // beforePack only adds the Office closure of the prepared payload to the unpack patterns.
  expect(next.build.beforePack).toBe('./scripts/prepare-pack.ts')
  // Unpack patterns are matched below the application directory, so payload-root patterns name the prepared directory.
  expect(next.build.asarUnpack).toEqual(expect.arrayContaining(['.desktop-build/payload/scripts/node-bin/**/*', '.desktop-build/payload/assets/**/*', '.desktop-build/payload/build/**/*']))
  expect(next.build.asarUnpack.every((pattern: string) => pattern.startsWith('**/') || pattern.startsWith('.desktop-build/payload/'))).toBe(true)
  expect(next.build.afterPack).toBe('./scripts/verify-packaged.ts')
  expect(next.build.afterAllArtifactBuild).toBe('./scripts/verify-fuses.ts')
  expect(next.build.electronFuses).toEqual({
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: false,
    runAsNode: true,
  })
  // The x64 interpreter payload rides beside the archive as extra resources.
  expect(next.build.win.extraResources).toEqual([{ from: '.desktop-build/runtime', to: 'runtime' }])
  expect(next.build.extraResources).toBeUndefined()
  expect(next.scripts['prepare:runtime']).toBe('node scripts/prepare-runtime.ts')
  // Like upstream Desktop's dev launcher, every development launch prepares the payload before the shell starts.
  expect(next.scripts.dev).toBe('yarn build && yarn prepare:runtime && node scripts/start.mjs')
  expect(next.scripts.start).toBe('yarn prepare:runtime && node scripts/start.mjs')
  for (const name of ['@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies']) expect(next.dependencies[name], name).toBe(next.dependencies['@deepseek-ai/dsh'])
  expect(next.build.win.icon).toBe('build/app-icon.ico')
  expect(existsSync(new URL('../build/app-icon.ico', import.meta.url))).toBe(true)
  expect(next.build.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true })
  expect(next.build.nsis.include).toBe('./adopted/build/installer.nsh')
  // No macOS packaging entry point survives in the workspace manifest.
  for (const name of ['dist:mac', 'dist:mac-smoke', 'check:mac-package']) expect(next.scripts[name], name).toBeUndefined()
})
