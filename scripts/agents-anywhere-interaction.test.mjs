import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { AA_WORKSPACES } from './agents-anywhere-release-policy.mjs'

for (const workspace of AA_WORKSPACES) {
  test(`${workspace}: AA owns a live Peer shared by event subscriptions and replies until scope disposal`, async t => {
    const source = readFileSync(new URL(`../${workspace}/node_modules/@agents-anywhere/dsh-bridge-next/lib/index.js`, import.meta.url), 'utf8')
    const start = source.indexOf('//#region src/host/dsh-runtime/interaction-stream.ts')
    const end = source.indexOf('//#endregion', start)
    assert.ok(start >= 0 && end > start)
    const cleanups = []
    const lifetime = []
    const peerController = new AbortController()
    const peer = { signal: peerController.signal }
    let notifyReady, failReady, receivedReply
    const published = new Promise((resolve, reject) => { notifyReady = resolve; failReady = reject })
    const ready = {
      connection: {
        createPeer(options) {
          assert.equal(options.principal.kind, 'owner')
          assert.equal(options.interactions, 'answer')
          cleanups.push(() => { lifetime.push('peer.dispose'); peerController.abort() })
          return peer
        },
        createSharedFetchHandler(channel) {
          assert.equal(channel, '/api')
          return { async fetch(request, replyPeer) {
            assert.equal(replyPeer, peer)
            assert.equal(replyPeer.signal.aborted, false)
            receivedReply = await request.json()
            return Response.json({ type: 'server-response', rpcId: receivedReply.rpcId, result: { ok: true } })
          } }
        },
      },
      typertGateway: { wireStream: {
        async open(endpoint, payload, uplink, streamPeer, signal) {
          assert.equal(endpoint, '$events')
          assert.equal(streamPeer, peer)
          assert.equal(streamPeer.signal.aborted, false)
          assert.equal(typeof uplink[Symbol.asyncIterator], 'function')
          return (async function* () {
            try {
              yield { type: 'ready', clientId: 'fixture-client' }
              if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
            } finally { lifetime.push('stream.end') }
          })()
        },
      } },
      effect(startEffect) { cleanups.push(startEffect()) },
    }
    const scope = { async dispose() { while (cleanups.length) await cleanups.pop()() } }
    const ctx = { inject(keys, apply) { assert.ok(keys.includes('connection')); apply(ready); return scope } }
    const InteractionStream = runInNewContext(source.slice(start, end) + '; InteractionStream', {
      AbortController, AbortSignal, Request, randomUUID, record: value => value,
      setTimeout$1: setTimeout, quietDiagnostics: { log() {} },
    })
    const stream = new InteractionStream(ctx, async () => {}, () => { if (stream.available) notifyReady() }, 'approval', {
      log(level, event) { if (level === 'warn') failReady(new Error(event)) },
    })
    t.after(() => stream.close())
    await published
    assert.equal(stream.available, true)
    await stream.reply('fixture-event', { kind: 'next' })
    assert.equal(receivedReply.method, '$events/result')
    assert.equal(receivedReply.payload.args.clientId, 'fixture-client')
    assert.equal(receivedReply.payload.args.eventId, 'fixture-event')
    await stream.close()
    assert.equal(stream.available, false)
    assert.equal(peer.signal.aborted, true)
    assert.deepEqual(lifetime, ['stream.end', 'peer.dispose'])
  })
}
