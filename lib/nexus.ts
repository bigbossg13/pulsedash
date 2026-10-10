// Client for the FTC Nexus API (https://ftc.nexus/en/api). Nexus runs queuing
// at events that use it, so it knows what FTCScout and FTC Events can't: which
// match is being queued right now, the queue crew's own time estimates,
// announcements and parts requests.
//
// Requests need a `Nexus-Api-Key` header: either the viewer's own key (sent
// straight from the browser) or, with no key, the site's proxy adds one.
//
// Notes on the feed, learned from the FRC version of the same API:
// - Played matches stay at status "On field" forever; only the LAST "On field"
//   match is really on the field.
// - `nowQueuing` is null whenever nothing is being queued (before the event,
//   during breaks, between phases). Without it, queue statuses aren't live.
// - Estimates are never in the past: an overdue estimate is clamped to
//   `dataAsOfTime`, so only estimates after `dataAsOfTime` are real times.
import type { Match } from './types'
import { fetchJson, HttpError } from './http'
import type { QueueStatus } from './derive'

export const NEXUS_URL = process.env.NEXT_PUBLIC_NEXUS_URL || 'https://ftc.nexus/api/v1'

export type NexusStatus = 'Queuing soon' | 'Now queuing' | 'On deck' | 'On field'

export interface NexusMatch {
  label: string
  status: string
  red: (number | null)[]
  blue: (number | null)[]
  breakAfter: string | null
  times: {
    scheduledStart: number | null
    estimatedQueue: number | null
    estimatedOnDeck: number | null
    estimatedOnField: number | null
    estimatedStart: number | null
    actualQueue: number | null
    actualStart: number | null
  }
}

export interface NexusPost {
  id: string
  text: string
  /** Team number for parts requests. */
  team: number | null
  posted: number | null
}

export interface NexusEvent {
  key: string
  /** When Nexus last updated (epoch ms). */
  asOf: number
  nowQueuing: string | null
  matches: NexusMatch[]
  announcements: NexusPost[]
  partsRequests: NexusPost[]
}

/** Nexus event keys are the season year plus the FIRST event code, lowercased (e.g. "2026usxxq1"). */
export function defaultNexusKey(season: number, code: string): string {
  return `${season}${code.toLowerCase()}`
}

/** Where to send Nexus requests: straight to Nexus with the viewer's key, or through the proxy. */
export function nexusBase(apiKey: string, proxy: string): { url: string; headers: Record<string, string> } | null {
  if (apiKey) return { url: NEXUS_URL, headers: { 'Nexus-Api-Key': apiKey } }
  if (proxy) return { url: `${proxy.trim().replace(/\/+$/, '')}/nexus/v1`, headers: {} }
  return null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const team = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

export function normalizeNexus(key: string, raw: Raw): NexusEvent {
  const post = (p: Raw, text: unknown): NexusPost => ({
    id: String(p?.id ?? `${p?.postedTime}-${text}`),
    text: str(text) ?? '',
    team: team(p?.requestedByTeam),
    posted: num(p?.postedTime),
  })
  return {
    key,
    asOf: num(raw?.dataAsOfTime) ?? Date.now(),
    nowQueuing: str(raw?.nowQueuing),
    matches: (Array.isArray(raw?.matches) ? raw.matches : []).map((m: Raw): NexusMatch => ({
      label: str(m?.label) ?? '',
      status: str(m?.status) ?? '',
      red: (Array.isArray(m?.redTeams) ? m.redTeams : []).map(team),
      blue: (Array.isArray(m?.blueTeams) ? m.blueTeams : []).map(team),
      breakAfter: str(m?.breakAfter),
      times: {
        scheduledStart: num(m?.times?.scheduledStartTime),
        estimatedQueue: num(m?.times?.estimatedQueueTime),
        estimatedOnDeck: num(m?.times?.estimatedOnDeckTime),
        estimatedOnField: num(m?.times?.estimatedOnFieldTime),
        estimatedStart: num(m?.times?.estimatedStartTime),
        actualQueue: num(m?.times?.actualQueueTime),
        actualStart: num(m?.times?.actualStartTime),
      },
    })).filter((m: NexusMatch) => m.label),
    announcements: (Array.isArray(raw?.announcements) ? raw.announcements : [])
      .map((a: Raw) => post(a, a?.announcement)).filter((p: NexusPost) => p.text),
    partsRequests: (Array.isArray(raw?.partsRequests) ? raw.partsRequests : [])
      .map((p: Raw) => post(p, p?.parts)).filter((p: NexusPost) => p.text),
  }
}

/** Returns null when Nexus doesn't run this event (404). */
export async function fetchNexus(base: { url: string; headers: Record<string, string> }, key: string, signal?: AbortSignal): Promise<NexusEvent | null> {
  try {
    const raw = await fetchJson<Raw>(`${base.url}/event/${encodeURIComponent(key)}`, { headers: base.headers, signal, timeoutMs: 15_000 })
    return normalizeNexus(key, raw)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
}

/** "Qualification 12" → our qualification 12; "Playoff 3" → playoff match 3; "Final 2" → final 2. */
export function findNexusMatch(nexus: NexusEvent, match: Match): NexusMatch | null {
  for (const m of nexus.matches) {
    if (/replay/i.test(m.label)) continue
    const q = /^Qualification (\d+)/i.exec(m.label)
    if (q && match.level === 'qual' && Number(q[1]) === match.number) return m
    const p = /^Playoff (\d+)/i.exec(m.label)
    if (p && match.level === 'playoff' && match.label.startsWith('M') && Number(p[1]) === match.series) return m
    const f = /^Final (\d+)/i.exec(m.label)
    if (f && match.level === 'playoff' && match.label.startsWith('F') && Number(f[1]) === match.number) return m
  }
  return null
}

/** An estimate is only a real time if it's after the moment Nexus last updated (overdue ones are clamped). */
const future = (t: number | null, asOf: number) => (t != null && t > asOf ? t : null)

/** The match Nexus has on the field: the last "On field" entry, but only while Nexus is actively queuing. */
export function nexusOnField(nexus: NexusEvent): NexusMatch | null {
  if (!nexus.nowQueuing) return null
  for (let i = nexus.matches.length - 1; i >= 0; i--) if (nexus.matches[i].status === 'On field') return nexus.matches[i]
  return null
}

/**
 * Lets Nexus override the team's queue call. Nexus is the queue crew's own
 * system, so "Now queuing", "On deck" and "On field" are taken as they are,
 * and its estimates replace ours. Only while `nowQueuing` is set: otherwise the
 * statuses are leftovers and the estimate-based call stands.
 */
export function applyNexus(q: QueueStatus, nexus: NexusEvent | null): QueueStatus & { nexusStatus: string | null } {
  if (!nexus || !q.match) return { ...q, nexusStatus: null }
  const m = findNexusMatch(nexus, q.match)
  if (!m) return { ...q, nexusStatus: null }
  const estimatedStart = future(m.times.estimatedStart, nexus.asOf) ?? q.estimatedStart
  const queueAt = m.times.actualQueue ?? future(m.times.estimatedQueue, nexus.asOf) ?? q.queueAt
  const out = { ...q, estimatedStart, queueAt, nexusStatus: null as string | null }
  if (!nexus.nowQueuing) return out
  if (m.status === 'On field' && nexusOnField(nexus) === m) return { ...out, kind: 'on-field', nexusStatus: m.status }
  if (m.status === 'On deck' || m.status === 'Now queuing') return { ...out, kind: 'now', nexusStatus: m.status }
  return out
}

/** How far behind Nexus says the next match is, from its estimate vs the schedule. */
export function nexusDelay(nexus: NexusEvent): number | null {
  if (!nexus.nowQueuing) return null
  const next = nexus.matches.find(m => m.status === 'On deck' || m.status === 'Now queuing')
  if (!next?.times.scheduledStart || !next.times.estimatedStart) return null
  return next.times.estimatedStart - next.times.scheduledStart
}
