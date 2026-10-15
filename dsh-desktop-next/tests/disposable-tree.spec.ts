import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { PathLike } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'

const metadata = vi.hoisted(() => ({ followsLinks: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    lstatSync: (path: PathLike) => {
      const stat = actual.lstatSync(path)
      return metadata.followsLinks && stat.isSymbolicLink() ? actual.statSync(path) : stat
    },
  }
})

import { cleanupDisposableTree } from '../adopted/src/disposable-tree.ts'

it.each(['external', 'ancestor'])('unlinks a %s junction even when lstat reports a directory', (fixture) => {
  const parent = realpathSync(tmpdir())
  const root = mkdtempSync(join(parent, 'next-disposable-tree-'))
  const owned = join(root, 'owned')
  const target = fixture === 'ancestor' ? root : join(root, 'outside')
  try {
    mkdirSync(join(owned, 'modules'), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep.txt'), 'outside disposable root')
    symlinkSync(target, join(owned, 'modules', 'junction'), 'junction')
    metadata.followsLinks = true
    expect(cleanupDisposableTree(owned)).toBe(true)
    expect(existsSync(owned)).toBe(false)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('outside disposable root')
  } finally {
    metadata.followsLinks = false
    expect(dirname(realpathSync(root))).toBe(parent)
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
