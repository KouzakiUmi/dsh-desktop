import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps the original shadcn stylesheet and MIT permission without the unused CLI graph', () => {
  const source = readFileSync(new URL('../adopted/src/native-ui/shared/shadcn-tailwind.css', import.meta.url), 'utf8')
  const end = source.indexOf('*/\n')
  expect(end).toBeGreaterThan(0)
  expect(source.slice(0, end)).toContain('Copyright (c) 2023 shadcn')
  expect(source.slice(0, end)).toContain('Permission is hereby granted, free of charge')
  expect(createHash('sha256').update(source.slice(end + 3)).digest('hex')).toBe('bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a')
  const license = readFileSync(new URL('../assets/licenses/shadcn.txt', import.meta.url))
  expect(createHash('sha256').update(license).digest('hex')).toBe('1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f')
  const theme = readFileSync(new URL('../adopted/src/native-ui/shared/theme.css', import.meta.url), 'utf8')
  expect(theme).toContain('@import "./shadcn-tailwind.css";')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.devDependencies).not.toHaveProperty('shadcn')
})
