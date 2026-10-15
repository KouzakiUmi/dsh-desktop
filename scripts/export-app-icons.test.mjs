import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ICON_OUTPUTS, checkIconResources, iconSourceDigest } from './export-app-icons.mjs'

test('resource checks reject edited vector layers, edited exports and missing exports without Xcode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  const source = join(directory, 'app-icon.icon')
  mkdirSync(join(source, 'Assets'), { recursive: true })
  writeFileSync(join(source, 'icon.json'), '{"fill":"system-dark"}')
  writeFileSync(join(source, 'Assets/Logo.svg'), '<svg/>')
  for (const name of ICON_OUTPUTS) writeFileSync(join(directory, name), name)
  writeFileSync(join(directory, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(source),
    outputs: Object.fromEntries(ICON_OUTPUTS.map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')])),
  }))
  try {
    assert.doesNotThrow(() => checkIconResources(directory))
    writeFileSync(join(source, 'Assets/Logo.svg'), '<svg><path/></svg>')
    assert.throws(() => checkIconResources(directory), /resources are stale/)
    writeFileSync(join(source, 'Assets/Logo.svg'), '<svg/>')
    // The Windows ICO is the export every host can rebuild; a drifted copy must be reported.
    writeFileSync(join(directory, 'app-icon.ico'), 'old icon')
    assert.throws(() => checkIconResources(directory), /resources are stale/)
    writeFileSync(join(directory, 'app-icon.ico'), 'app-icon.ico')
    rmSync(join(directory, 'app-icon.png'))
    assert.throws(() => checkIconResources(directory), /resources are stale/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
