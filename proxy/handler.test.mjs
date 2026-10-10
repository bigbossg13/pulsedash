import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHandler } from './handler.mjs'

function fakeFetch(responder) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return responder(url)
  }
  return { impl, calls }
}

const ok = body => new Response(JSON.stringify(body), { status: 200 })
const req = (path, init = {}) => new Request(`https://proxy.test${path}`, init)

test('forwards allowed paths with credentials and caches the response', async () => {
  let t = 0
  const f = fakeFetch(() => ok({ rankings: [] }))
  const handle = createHandler({ username: 'user', token: 'key', fetchImpl: f.impl, now: () => t })
  const res = await handle(req('/v2.0/2026/rankings/USCAFFS'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(await res.json(), { rankings: [] })
  assert.equal(f.calls[0].url, 'https://ftc-api.firstinspires.org/v2.0/2026/rankings/USCAFFS')
  assert.equal(f.calls[0].init.headers.authorization, `Basic ${btoa('user:key')}`)

  t = 5_000
  const again = await handle(req('/v2.0/2026/rankings/USCAFFS'))
  assert.equal(again.headers.get('x-cache'), 'HIT')
  assert.equal(f.calls.length, 1)

  t = 20_000
  await handle(req('/v2.0/2026/rankings/USCAFFS'))
  assert.equal(f.calls.length, 2)
})

test('rejects other paths, methods and unknown query parameters', async () => {
  const f = fakeFetch(() => ok({}))
  const handle = createHandler({ username: 'u', token: 't', fetchImpl: f.impl })
  assert.equal((await handle(req('/v2.0/2026/teams/../../secret'))).status, 404)
  assert.equal((await handle(req('/https://evil.example'))).status, 404)
  assert.equal((await handle(req('/v2.0/2026/rankings/X', { method: 'POST' }))).status, 405)
  await handle(req('/v2.0/2026/teams?eventCode=USCAFFS&page=2&apiKey=steal&eventCode2=x'))
  assert.equal(f.calls.at(-1).url, 'https://ftc-api.firstinspires.org/v2.0/2026/teams?eventCode=USCAFFS&page=2')
})

test('enforces the origin allow-list', async () => {
  const f = fakeFetch(() => ok({}))
  const handle = createHandler({ username: 'u', token: 't', fetchImpl: f.impl, allowedOrigins: 'https://pit.example, http://localhost:3000/' })
  const allowed = await handle(req('/v2.0/2026/events', { headers: { origin: 'http://localhost:3000' } }))
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  const blocked = await handle(req('/v2.0/2026/events', { headers: { origin: 'https://other.example' } }))
  assert.equal(blocked.status, 403)
  const preflight = await handle(req('/v2.0/2026/events', { method: 'OPTIONS', headers: { origin: 'https://pit.example' } }))
  assert.equal(preflight.status, 204)
})

test('reports upstream problems without leaking details', async () => {
  const html = fakeFetch(() => new Response('<html>oops</html>', { status: 200 }))
  assert.equal((await createHandler({ username: 'u', token: 't', fetchImpl: html.impl })(req('/v2.0/2026/events'))).status, 502)
  const missing = fakeFetch(() => new Response('No rankings', { status: 404 }))
  assert.equal((await createHandler({ username: 'u', token: 't', fetchImpl: missing.impl })(req('/v2.0/2026/rankings/X'))).status, 404)
  const unauthorized = fakeFetch(() => new Response('nope', { status: 401 }))
  assert.equal((await createHandler({ username: 'u', token: 't', fetchImpl: unauthorized.impl })(req('/v2.0/2026/events'))).status, 502)
  const down = fakeFetch(() => { throw new TypeError('network') })
  assert.equal((await createHandler({ username: 'u', token: 't', fetchImpl: down.impl })(req('/v2.0/2026/events'))).status, 502)
  const noKey = await createHandler({})(req('/v2.0/2026/events'))
  assert.equal(noKey.status, 500)
  const health = await createHandler({})(req('/health'))
  assert.deepEqual(await health.json(), { ok: true, service: 'pulsedash-ftc-events-proxy', configured: false, nexus: false })
})

test('forwards allow-listed Nexus paths with the Nexus key', async () => {
  const f = fakeFetch(() => ok({ nowQueuing: null, matches: [] }))
  const handle = createHandler({ nexusKey: 'nx-key', fetchImpl: f.impl })
  assert.equal((await handle(req('/nexus/v1/event/2026usxxq1'))).status, 200)
  assert.equal(f.calls[0].url, 'https://ftc.nexus/api/v1/event/2026usxxq1')
  assert.equal(f.calls[0].init.headers['Nexus-Api-Key'], 'nx-key')
  await handle(req('/nexus/v1/event/2026usxxq1/alliances'))
  assert.equal(f.calls[1].url, 'https://ftc.nexus/api/v1/event/2026usxxq1/alliances')
  assert.equal((await handle(req('/nexus/v1/event/x/secrets'))).status, 404)
  assert.equal((await createHandler({ fetchImpl: f.impl })(req('/nexus/v1/events'))).status, 500)
})
