// FTC Events API proxy for the PulseDash display.
//
// The official API needs a private key (HTTP basic auth) and doesn't send
// CORS headers, so a browser can't call it directly. This handler adds the key
// on the server side, only forwards read-only requests for the endpoints the
// display uses, and caches responses for a few seconds so many pit screens at
// one event make a single upstream request.
//
// It uses only web-standard Request/Response, so the same code runs as a
// Cloudflare Worker (worker.mjs) or a plain Node server (server.mjs).

const UPSTREAM = 'https://ftc-api.firstinspires.org'
const NEXUS_UPSTREAM = 'https://ftc.nexus/api/v1'
// FTC Nexus: event list, one event's live status, its alliances and pits.
const NEXUS_PATH = /^\/nexus\/v1\/(events|event\/[A-Za-z0-9_-]{1,40}(\/(alliances|pits))?)$/
const PATH = /^\/v2\.0\/\d{4}\/(events|teams|schedule|rankings|alliances|scores|matches|awards)(\/[A-Za-z0-9_-]{1,32}){0,3}$/
const PARAMS = new Set(['eventCode', 'teamNumber', 'page', 'tournamentLevel', 'start', 'end', 'matchNumber'])
const MAX_ENTRIES = 500

function corsHeaders(origin, allowed) {
  if (allowed.includes('*')) return { 'access-control-allow-origin': '*' }
  if (origin && allowed.includes(origin)) return { 'access-control-allow-origin': origin, vary: 'Origin' }
  return {}
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } })
}

/**
 * @param {{ username?: string, token?: string, nexusKey?: string, allowedOrigins?: string, cacheSeconds?: number,
 *           fetchImpl?: typeof fetch, now?: () => number }} options
 */
export function createHandler({ username, token, nexusKey, allowedOrigins = '*', cacheSeconds = 15, fetchImpl = fetch, now = Date.now } = {}) {
  const allowed = allowedOrigins.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)
  const cache = new Map()
  const auth = username && token ? `Basic ${btoa(`${username}:${token}`)}` : null

  return async function handle(request) {
    const origin = request.headers.get('origin')
    const cors = {
      ...corsHeaders(origin, allowed),
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '86400',
    }
    if (origin && !cors['access-control-allow-origin']) return json({ error: 'Origin not allowed' }, 403, {})
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'GET') return json({ error: 'Only GET is supported' }, 405, cors)

    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'pulsedash-ftc-events-proxy', configured: Boolean(auth), nexus: Boolean(nexusKey) }, 200, cors)
    }
    let target
    let upstreamHeaders
    if (NEXUS_PATH.test(url.pathname)) {
      if (!nexusKey) return json({ error: 'The proxy has no Nexus API key configured' }, 500, cors)
      target = `${NEXUS_UPSTREAM}${url.pathname.slice('/nexus/v1'.length)}`
      upstreamHeaders = { 'Nexus-Api-Key': nexusKey, accept: 'application/json' }
    } else {
      if (!PATH.test(url.pathname)) return json({ error: 'Path not allowed' }, 404, cors)
      if (!auth) return json({ error: 'The proxy has no FTC Events API credentials configured' }, 500, cors)
      const params = new URLSearchParams()
      for (const [k, v] of url.searchParams) if (PARAMS.has(k) && /^[A-Za-z0-9_-]{1,32}$/.test(v)) params.set(k, v)
      const query = params.toString()
      target = `${UPSTREAM}${url.pathname}${query ? `?${query}` : ''}`
      upstreamHeaders = { authorization: auth, accept: 'application/json' }
    }

    const headers = { ...cors, 'content-type': 'application/json', 'cache-control': `public, max-age=${cacheSeconds}` }
    const hit = cache.get(target)
    if (hit && now() - hit.at < cacheSeconds * 1000) return new Response(hit.body, { status: 200, headers: { ...headers, 'x-cache': 'HIT' } })

    let res
    try {
      res = await fetchImpl(target, { headers: upstreamHeaders })
    } catch {
      return json({ error: 'Could not reach the upstream API' }, 502, cors)
    }
    const body = await res.text()
    if (!res.ok) {
      // 400/404 usually mean "no data yet" (e.g. rankings before matches); pass them through.
      const status = res.status === 400 || res.status === 404 ? res.status : 502
      return json({ error: `Upstream API answered ${res.status}` }, status, cors)
    }
    try {
      JSON.parse(body)
    } catch {
      return json({ error: 'Upstream API sent a non-JSON response' }, 502, cors)
    }
    cache.set(target, { at: now(), body })
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
    return new Response(body, { status: 200, headers: { ...headers, 'x-cache': 'MISS' } })
  }
}
