/** Exercise the shipped JSONL worker and native lock after retiring Desktop's preset alias. */
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
// Pull the `ctx.sessionPersistence` Context augmentation into this program:
// 0.2.1-alpha.3's JSONL entry no longer imports the seam package itself.
import type {} from '@deepseek-ai/dsh-session-persistence'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// The channels ship different entry shapes for the same backend: 0.2.1-alpha.3
// exports a named function plugin (`apply`), while 0.2.0-rc.2 exports the
// backend class as the default. Both are cordis plugin entries; read whichever
// the installed module actually provides so this spec compiles and runs
// against either channel's installed contract. Spread to a plain object
// first: module namespaces can inherit `Function.prototype.apply` under a
// test runner's ESM interop, and own-property selection must not consult the
// prototype chain.
const shipped: { apply?: Plugin.Object; default?: Plugin.Constructor } = { ...JsonlSessionPersistence }

it('migrates a released code session through the installed V4 worker and preserves its V2 log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-v4-migration-'))
  const id = SessionId('desktop-code-session')
  const directory = join(root, '_no-cwd', id)
  const ctx = new Context()
  const call = { type: 'tool-call', id: 'root-call', name: 'run_code', arguments: '{"code":"return 1"}' }
  const dispatch = { rootCallId: call.id, parentCallId: call.id, subCallId: 'child-call', name: 'read_file', arguments: { path: 'code.txt' } }
  const text = [{ type: 'text', text: 'Keep code and tool/code-dispatch as literal text.' }]
  const rows = [
    { type: 'agent-preset/selected', data: { agentPreset: 'code' }, ignorable: true },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: { id: 'user', role: 'user', source: { kind: 'user' }, content: text } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
      id: 'assistant', role: 'assistant', content: [call], source: { kind: 'model', provider: 'historical', model: 'historical' },
    }, stream: [] } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: call.id, name: call.name, arguments: call.arguments } },
    { type: 'tool/code-dispatch-start', data: dispatch },
    { type: 'tool/code-dispatch', data: { ...dispatch, isError: false, content: text } },
    { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
      id: 'result', role: 'user', source: { kind: 'tool', callId: call.id },
      content: [{ type: 'tool-result', toolCallId: call.id, isError: false, content: text }],
    } } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ ...row, seq, time: 1000 + seq }))
  const source = [
    { type: 'session', version: 2, id, createdAt: 1, isSeeded: false, delegationDepth: 0, agentPreset: 'code' },
    ...rows,
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'session.v2.jsonl'), source)
    const backend = shipped.apply ?? shipped.default
    if (backend === undefined) throw new Error('dsh-session-persistence-jsonl exposes no plugin entry')
    await ctx.plugin(backend, { root, compression: 'none' })
    const handle = await ctx.sessionPersistence.open(id, 'write')
    try {
      expect(handle.header).toMatchObject({ version: 4, agentPreset: 'ptc' })
      const restored = await handle.read()
      expect(restored.events.map(event => event.type)).toEqual(expect.arrayContaining([
        'tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'system/message',
      ]))
      expect(restored.events).toContainEqual(expect.objectContaining({ type: 'agent-preset/selected', data: { agentPreset: 'ptc' } }))
      expect(restored.events.find(event => event.type === 'user/message')?.data).toMatchObject({ content: text })
    } finally {
      await handle.close()
    }
    await ctx.sessionPersistence.flush()
    expect(await readFile(join(directory, 'session.v2.jsonl'), 'utf8')).toBe(source)
    const published = await readFile(join(directory, 'session.v4.jsonl'), 'utf8')
    expect(JSON.parse(published.split('\n')[0]!)).toMatchObject({ version: 4, agentPreset: 'ptc' })
    const reloaded = await ctx.sessionPersistence.open(id, 'read')
    try { expect(reloaded.header.agentPreset).toBe('ptc') } finally { await reloaded.close() }
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
