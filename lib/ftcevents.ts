// Client for the official FTC Events API (https://ftc-events.firstinspires.org/services/API).
// The API needs a private key and doesn't allow browser requests, so the
// display reaches it through a small proxy (see /proxy) that adds the key.
import type { AllianceColor, AllianceSelection, EventInfo, Match, MatchTeam, Ranking, SourceData, TeamInfo } from './types'
import { fetchJson, HttpError } from './http'
import { parseEventTime } from './time'

export const DEFAULT_PROXY = process.env.NEXT_PUBLIC_FTC_EVENTS_PROXY ?? ''

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function proxyBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v2\.0$/i, '')
}

export function isUsableProxy(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
  } catch {
    return false
  }
}

async function get(base: string, path: string, signal?: AbortSignal): Promise<Raw | null> {
  try {
    return await fetchJson<Raw>(`${proxyBase(base)}/v2.0/${path}`, { signal, timeoutMs: 15_000 })
  } catch (err) {
    // No rankings or alliances yet is a normal state, not a failure.
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null
    throw err
  }
}

export function normalizeOfficialEvent(raw: Raw, season: number): EventInfo {
  return {
    season,
    code: raw.code,
    name: str(raw.name) ?? raw.code,
    start: str(raw.dateStart)?.slice(0, 10) ?? null,
    end: str(raw.dateEnd)?.slice(0, 10) ?? null,
    timezone: str(raw.timezone),
    venue: str(raw.venue),
    city: str(raw.city),
    state: str(raw.stateprov),
    country: str(raw.country),
    type: str(raw.typeName) ?? str(raw.type),
    liveStreamUrl: str(raw.liveStreamUrl),
    website: str(raw.website),
    fieldCount: num(raw.fieldCount),
    remote: Boolean(raw.remote),
  }
}

const STATION = /^(Red|Blue)([123])$/

function labels(level: string, series: number, n: number, description: string | null): Pick<Match, 'level' | 'label' | 'longLabel'> {
  switch (level) {
    case 'QUALIFICATION':
    case 'OTHER':
      return { level: 'qual', label: `Q${n}`, longLabel: description ?? `Qualification ${n}` }
    case 'SEMIFINAL':
      return { level: 'playoff', label: `SF${series}-${n}`, longLabel: description ?? `Semifinal ${series} match ${n}` }
    case 'FINAL':
      return { level: 'playoff', label: `F${n}`, longLabel: description ?? `Final ${n}` }
    default:
      return {
        level: 'playoff',
        label: n > 1 ? `M${series}.${n}` : `M${series}`,
        longLabel: description ?? (n > 1 ? `Playoff match ${series}, game ${n}` : `Playoff match ${series}`),
      }
  }
}

function score(final: unknown, auto: unknown, foul: unknown) {
  const total = num(final)
  if (total == null) return null
  const a = num(auto)
  const f = num(foul)
  return { total, auto: a, penalty: f, teleop: a != null && f != null ? Math.max(0, total - a - f) : null }
}

export function normalizeSchedule(list: Raw[], timeZone: string | null): Match[] {
  const out: Match[] = []
  for (const m of list ?? []) {
    const series = num(m.series) ?? 0
    const n = num(m.matchNumber) ?? 0
    const l = labels(m.tournamentLevel, series, n, str(m.description))
    const teams: MatchTeam[] = []
    for (const t of m.teams ?? []) {
      const s = STATION.exec(t.station ?? '')
      if (!s || num(t.teamNumber) == null || t.teamNumber === 0) continue
      teams.push({
        team: t.teamNumber,
        alliance: s[1].toLowerCase() as AllianceColor,
        station: Number(s[2]),
        onField: t.onField ?? true,
        surrogate: Boolean(t.surrogate),
        noShow: Boolean(t.noShow),
        dq: Boolean(t.dq),
      })
    }
    const red = score(m.scoreRedFinal, m.scoreRedAuto, m.scoreRedFoul)
    const blue = score(m.scoreBlueFinal, m.scoreBlueAuto, m.scoreBlueFoul)
    out.push({
      key: `${l.level}-${m.tournamentLevel}-${series}-${n}`,
      ...l,
      series,
      number: n,
      scheduled: parseEventTime(m.startTime, timeZone),
      actual: parseEventTime(m.actualStartTime, timeZone),
      posted: parseEventTime(m.postResultTime, timeZone),
      played: m.postResultTime != null || (red != null && blue != null),
      field: m.field != null && m.field !== '' ? String(m.field) : null,
      teams,
      red,
      blue,
    })
  }
  return out
}

export function normalizeRankings(list: Raw[]): { rankings: Ranking[]; teams: Record<number, TeamInfo> } {
  const rankings: Ranking[] = []
  const teams: Record<number, TeamInfo> = {}
  for (const r of list ?? []) {
    const team = num(r.teamNumber)
    const rank = num(r.rank)
    if (team == null || rank == null || rank <= 0) continue
    rankings.push({
      team,
      rank,
      rankingScore: num(r.sortOrder1),
      tiebreaker: num(r.sortOrder2),
      wins: num(r.wins),
      losses: num(r.losses),
      ties: num(r.ties),
      played: num(r.matchesPlayed),
    })
    if (str(r.teamName)) teams[team] = { number: team, name: str(r.teamName), city: null, state: null, country: null, rookieYear: null }
  }
  rankings.sort((a, b) => a.rank - b.rank)
  return { rankings, teams }
}

export function normalizeAlliances(list: Raw[]): AllianceSelection[] {
  return (list ?? [])
    .map((a: Raw): AllianceSelection => ({
      number: num(a.number),
      name: str(a.name) ?? `Alliance ${a.number}`,
      teams: [a.captain, a.round1, a.round2, a.round3, a.backup].filter((t): t is number => num(t) != null && t > 0),
    }))
    .filter(a => a.teams.length > 0)
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
}

export function normalizeTeams(list: Raw[]): Record<number, TeamInfo> {
  const teams: Record<number, TeamInfo> = {}
  for (const t of list ?? []) {
    const n = num(t.teamNumber)
    if (n == null) continue
    teams[n] = {
      number: n,
      name: str(t.nameShort) ?? str(t.nameFull),
      city: str(t.city),
      state: str(t.stateProv),
      country: str(t.country),
      rookieYear: num(t.rookieYear),
    }
  }
  return teams
}

export interface OfficialOptions {
  /** Event details and the team list change rarely: fetch them on the first load only. */
  includeEvent: boolean
  timeZone: string | null
}

/** Fetches schedule, rankings and alliances (and optionally event + teams). Throws only if nothing worked. */
export async function fetchOfficialData(base: string, season: number, code: string, opts: OfficialOptions, signal?: AbortSignal): Promise<SourceData> {
  const c = encodeURIComponent(code)
  const s = Number(season)
  const jobs = {
    event: opts.includeEvent ? get(base, `${s}/events?eventCode=${c}`, signal) : null,
    teams: opts.includeEvent ? get(base, `${s}/teams?eventCode=${c}`, signal) : null,
    qual: get(base, `${s}/schedule/${c}/qual/hybrid`, signal),
    playoff: get(base, `${s}/schedule/${c}/playoff/hybrid`, signal),
    rankings: get(base, `${s}/rankings/${c}`, signal),
    alliances: get(base, `${s}/alliances/${c}`, signal),
  }
  const keys = Object.keys(jobs) as (keyof typeof jobs)[]
  const settled = await Promise.allSettled(keys.map(k => jobs[k]))
  const results = Object.fromEntries(keys.map((k, i) => [k, settled[i]])) as Record<keyof typeof jobs, PromiseSettledResult<Raw>>
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length === settled.length) throw failures[0].reason
  const value = (k: keyof typeof jobs) => (results[k].status === 'fulfilled' ? results[k].value : null)

  const out: SourceData = {}
  const rawEvent = value('event')?.events?.[0]
  if (rawEvent) out.event = normalizeOfficialEvent(rawEvent, s)
  const tz = out.event?.timezone ?? opts.timeZone
  const qual = value('qual')
  const playoff = value('playoff')
  if (qual || playoff) out.matches = normalizeSchedule([...(qual?.schedule ?? []), ...(playoff?.schedule ?? [])], tz)
  const rankings = value('rankings')
  if (rankings) {
    const r = normalizeRankings(rankings.rankings)
    out.rankings = r.rankings
    out.teams = r.teams
  }
  const teams = value('teams')
  if (teams?.teams) out.teams = { ...out.teams, ...normalizeTeams(teams.teams) }
  const alliances = value('alliances')
  if (alliances) out.alliances = normalizeAlliances(alliances.alliances)
  return out
}
