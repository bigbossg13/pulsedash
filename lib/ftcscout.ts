// FTCScout GraphQL client (https://ftcscout.org/api). FTCScout allows
// cross-origin requests, so the display calls it straight from the browser.
//
// Stats and score types are generated per season (TeamEventStats2026,
// MatchScores2026, ...), so the season's types are looked up first and the
// queries only ask for fields that exist. A renamed or removed field is then
// skipped instead of breaking the whole display.
import type {
  AllianceColor, AllianceScore, EventInfo, EventSummary, Match, MatchTeam, Ranking,
  SeasonStats, SourceData, TeamInfo, TeamStats,
} from './types'
import { fetchJson, HttpError } from './http'

export const FTCSCOUT_URL = process.env.NEXT_PUBLIC_FTCSCOUT_URL || 'https://api.ftcscout.org/graphql'

export async function gql<T>(operationName: string, query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const json = await fetchJson<{ data?: T; errors?: { message: string }[] }>(FTCSCOUT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationName, query, variables }),
    signal,
  })
  if (json.errors?.length) {
    throw new Error(`FTCScout: ${[...new Set(json.errors.map(e => e.message))].join('; ')}`)
  }
  if (!json.data) throw new Error('FTCScout returned no data')
  return json.data
}

// ── Season schema ────────────────────────────────────────────────────────────

export interface SeasonSchema {
  season: number
  tep: string | null
  tepFields: string[]
  groupFields: string[]
  scores: string | null
  allianceFields: string[]
  eventFields: string[]
  matchFields: string[]
}

type TypeInfo = { name: string; fields: { name: string }[] | null } | null

export function schemaQuery(season: number): string {
  const s = Number(season)
  const t = (alias: string, name: string) => `${alias}: __type(name: "${name}") { name fields { name } }`
  return `query PulseDashSchema {
  ${t('tep', `TeamEventStats${s}`)}
  ${t('tepTrad', `TeamEventStats${s}Trad`)}
  ${t('group', `TeamEventStats${s}Group`)}
  ${t('groupTrad', `TeamEventStats${s}TradGroup`)}
  ${t('ms', `MatchScores${s}`)}
  ${t('msTrad', `MatchScores${s}Trad`)}
  ${t('msAlliance', `MatchScores${s}Alliance`)}
  ${t('event', 'Event')}
  ${t('match', 'Match')}
}`
}

export function parseSchema(season: number, data: Record<string, TypeInfo>): SeasonSchema {
  const names = (t: TypeInfo) => t?.fields?.map(f => f.name) ?? []
  const tep = data.tep ?? data.tepTrad
  const group = tep === data.tep ? data.group : data.groupTrad
  const ms = data.ms ?? data.msTrad
  return {
    season,
    tep: tep?.name ?? null,
    tepFields: names(tep),
    groupFields: names(group),
    scores: ms?.name ?? null,
    allianceFields: names(data.msAlliance),
    eventFields: names(data.event),
    matchFields: names(data.match),
  }
}

const SCHEMA_TTL = 24 * 60 * 60 * 1000
const schemaCache = new Map<number, Promise<SeasonSchema>>()

export function loadSchema(season: number, signal?: AbortSignal): Promise<SeasonSchema> {
  const key = `pulsedash:schema:${season}`
  const cached = schemaCache.get(season)
  if (cached) return cached
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (stored && Date.now() - stored.at < SCHEMA_TTL) {
      const p = Promise.resolve(stored.schema as SeasonSchema)
      schemaCache.set(season, p)
      return p
    }
  } catch { /* storage unavailable */ }
  const p = gql<Record<string, TypeInfo>>('PulseDashSchema', schemaQuery(season), {}, signal)
    .then(data => {
      const schema = parseSchema(season, data)
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), schema })) } catch { /* ignore */ }
      return schema
    })
  p.catch(() => schemaCache.delete(season))
  schemaCache.set(season, p)
  return p
}

// ── Queries ──────────────────────────────────────────────────────────────────

const pick = (have: string[], want: string[]) => want.filter(f => have.includes(f)).join(' ')

const GROUP_FIELDS = ['totalPointsNp', 'totalPoints', 'autoPoints', 'dcPoints', 'egPoints']
const SCORE_FIELDS = ['totalPoints', 'totalPointsNp', 'autoPoints', 'dcPoints', 'egPoints', 'penaltyPointsByOpp']
const TEP_FIELDS = ['rank', 'rp', 'tb1', 'tb2', 'wins', 'losses', 'ties', 'qualMatchesPlayed']
const EVENT_FIELDS = ['season', 'code', 'name', 'type', 'start', 'end', 'timezone', 'remote', 'fieldCount', 'website', 'liveStreamURL']
const MATCH_FIELDS = ['id', 'series', 'matchNum', 'tournamentLevel', 'scheduledStartTime', 'actualStartTime', 'postResultTime', 'hasBeenPlayed', 'description']

/** Builds the live event query for a season. Exported for tests. */
export function eventQuery(schema: SeasonSchema): string {
  const group = pick(schema.groupFields, GROUP_FIELDS)
  const tepBody = [
    pick(schema.tepFields, TEP_FIELDS),
    ...(group ? ['opr', 'avg', 'dev'].filter(g => schema.tepFields.includes(g)).map(g => `${g} { ${group} }`) : []),
  ].filter(Boolean).join(' ')
  const stats = schema.tep && tepBody ? `stats { ... on ${schema.tep} { ${tepBody} } }` : ''
  const alliance = pick(schema.allianceFields, SCORE_FIELDS)
  const scores = schema.scores && alliance ? `scores { ... on ${schema.scores} { red { ${alliance} } blue { ${alliance} } } }` : ''
  const preview = schema.eventFields.includes('previewStats') ? 'previewStats { teamNumber npOpr }' : ''
  return `query PulseDashEventLive($season: Int!, $code: String!) {
  eventByCode(season: $season, code: $code) {
    ${pick(schema.eventFields, EVENT_FIELDS)}
    location { venue city state country }
    teams { teamNumber team { number name rookieYear location { city state country } } ${stats} }
    matches { ${pick(schema.matchFields, MATCH_FIELDS)} teams { teamNumber alliance station allianceRole surrogate noShow dq onField } ${scores} }
    ${preview}
  }
}`
}

// ── Normalization ────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const time = (v: unknown): number | null => {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) && new Date(t).getUTCFullYear() > 2000 ? t : null
}

export function normalizeEvent(raw: Raw): EventInfo {
  return {
    season: raw.season,
    code: raw.code,
    name: str(raw.name) ?? raw.code,
    start: str(raw.start)?.slice(0, 10) ?? null,
    end: str(raw.end)?.slice(0, 10) ?? null,
    timezone: str(raw.timezone),
    venue: str(raw.location?.venue),
    city: str(raw.location?.city),
    state: str(raw.location?.state),
    country: str(raw.location?.country),
    type: str(raw.type),
    liveStreamUrl: str(raw.liveStreamURL),
    website: str(raw.website),
    fieldCount: num(raw.fieldCount),
    remote: Boolean(raw.remote),
  }
}

const ROLE_ORDER: Record<string, number> = { Captain: 1, FirstPick: 2, SecondPick: 3 }
const STATION_ORDER: Record<string, number> = { One: 1, Two: 2, NotOnField: 3 }

function matchLabels(level: string, series: number, n: number): Pick<Match, 'level' | 'label' | 'longLabel'> {
  switch (level) {
    case 'Quals':
      return { level: 'qual', label: `Q${n}`, longLabel: `Qualification ${n}` }
    case 'Semis':
      return { level: 'playoff', label: `SF${series}-${n}`, longLabel: `Semifinal ${series} match ${n}` }
    case 'Finals':
      return { level: 'playoff', label: `F${n}`, longLabel: `Final ${n}` }
    default:
      return n > 1
        ? { level: 'playoff', label: `M${series}.${n}`, longLabel: `Playoff match ${series}, game ${n}` }
        : { level: 'playoff', label: `M${series}`, longLabel: `Playoff match ${series}` }
  }
}

function allianceScore(raw: Raw): AllianceScore | null {
  if (!raw) return null
  const total = num(raw.totalPoints) ?? num(raw.totalPointsNp)
  if (total == null) return null
  const dc = num(raw.dcPoints)
  const eg = num(raw.egPoints)
  return {
    total,
    auto: num(raw.autoPoints),
    teleop: dc == null && eg == null ? null : (dc ?? 0) + (eg ?? 0),
    penalty: num(raw.penaltyPointsByOpp),
  }
}

export function normalizeMatches(raw: Raw[]): Match[] {
  const out: Match[] = []
  for (const m of raw ?? []) {
    const series = num(m.series) ?? 0
    const n = num(m.matchNum) ?? (num(m.id) ?? 0) % 1000
    const labels = matchLabels(m.tournamentLevel, series, n)
    const playoff = labels.level === 'playoff'
    const teams: MatchTeam[] = []
    for (const t of m.teams ?? []) {
      const alliance: AllianceColor | null = t.alliance === 'Red' ? 'red' : t.alliance === 'Blue' ? 'blue' : null
      if (!alliance || num(t.teamNumber) == null) continue
      teams.push({
        team: t.teamNumber,
        alliance,
        station: (playoff ? ROLE_ORDER[t.allianceRole] : STATION_ORDER[t.station]) ?? STATION_ORDER[t.station] ?? 1,
        onField: t.onField ?? t.station !== 'NotOnField',
        surrogate: Boolean(t.surrogate),
        noShow: Boolean(t.noShow),
        dq: Boolean(t.dq),
      })
    }
    const red = allianceScore(m.scores?.red)
    const blue = allianceScore(m.scores?.blue)
    out.push({
      key: `${labels.level}-${m.tournamentLevel}-${series}-${n}`,
      ...labels,
      series,
      number: n,
      scheduled: time(m.scheduledStartTime),
      actual: time(m.actualStartTime),
      posted: time(m.postResultTime),
      played: Boolean(m.hasBeenPlayed) || (red != null && blue != null),
      field: null,
      teams,
      red,
      blue,
    })
  }
  return out
}

export function normalizeEventData(raw: Raw): SourceData {
  const teams: Record<number, TeamInfo> = {}
  const stats: Record<number, TeamStats> = {}
  const rankings: Ranking[] = []
  for (const tep of raw.teams ?? []) {
    const n = num(tep.teamNumber)
    if (n == null) continue
    const t = tep.team ?? {}
    teams[n] = {
      number: n,
      name: str(t.name),
      city: str(t.location?.city),
      state: str(t.location?.state),
      country: str(t.location?.country),
      rookieYear: num(t.rookieYear),
    }
    const s = tep.stats
    if (s) {
      stats[n] = {
        opr: num(s.opr?.totalPoints) ?? num(s.opr?.totalPointsNp),
        npOpr: num(s.opr?.totalPointsNp) ?? num(s.opr?.totalPoints),
        autoOpr: num(s.opr?.autoPoints),
        teleopOpr: s.opr?.dcPoints == null && s.opr?.egPoints == null ? null : (num(s.opr?.dcPoints) ?? 0) + (num(s.opr?.egPoints) ?? 0),
        avg: num(s.avg?.totalPointsNp) ?? num(s.avg?.totalPoints),
        dev: num(s.dev?.totalPointsNp) ?? num(s.dev?.totalPoints),
        source: 'event',
      }
      if (num(s.rank) != null && s.rank > 0) {
        rankings.push({
          team: n,
          rank: s.rank,
          rankingScore: num(s.rp),
          tiebreaker: num(s.tb1),
          wins: num(s.wins),
          losses: num(s.losses),
          ties: num(s.ties),
          played: num(s.qualMatchesPlayed),
        })
      }
    }
  }
  for (const p of raw.previewStats ?? []) {
    const n = num(p.teamNumber)
    const v = num(p.npOpr)
    if (n == null || v == null || stats[n]) continue
    stats[n] = { opr: null, npOpr: v, autoOpr: null, teleopOpr: null, avg: null, dev: null, source: 'preview' }
  }
  rankings.sort((a, b) => a.rank - b.rank)
  return {
    event: normalizeEvent(raw),
    teams,
    matches: normalizeMatches(raw.matches),
    rankings,
    stats,
  }
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

function forgetSchema(season: number) {
  schemaCache.delete(season)
  try { localStorage.removeItem(`pulsedash:schema:${season}`) } catch { /* ignore */ }
}

export async function fetchEventData(season: number, code: string, signal?: AbortSignal): Promise<SourceData> {
  const run = async () => {
    const schema = await loadSchema(season, signal)
    return gql<{ eventByCode: Raw }>('PulseDashEventLive', eventQuery(schema), { season, code }, signal)
  }
  let data: { eventByCode: Raw }
  try {
    data = await run()
  } catch (err) {
    // A query error (GraphQL error, or HTTP 400 for an unknown field) can mean
    // FTCScout changed its schema since it was cached.
    const queryError = err instanceof HttpError ? err.status === 400 : err instanceof Error && err.message.startsWith('FTCScout:')
    if (signal?.aborted || !queryError) throw err
    forgetSchema(season)
    data = await run()
  }
  if (!data.eventByCode) throw new Error(`FTCScout has no event ${code} in ${season}`)
  return normalizeEventData(data.eventByCode)
}

/** Season OPR and world ranks for a list of teams, in batches of aliased lookups. */
export async function fetchSeasonStats(season: number, teams: number[], signal?: AbortSignal): Promise<Record<number, SeasonStats>> {
  const out: Record<number, SeasonStats> = {}
  const stat = (s: Raw) => ({ value: num(s?.value), rank: num(s?.rank) })
  for (let i = 0; i < teams.length; i += 80) {
    const batch = teams.slice(i, i + 80).filter(n => Number.isInteger(n))
    if (!batch.length) continue
    const query = `query PulseDashSeasonStats { ${batch
      .map(n => `t${n}: teamByNumber(number: ${n}) { quickStats(season: ${Number(season)}) { tot { value rank } auto { value rank } dc { value rank } eg { value rank } count } }`)
      .join('\n')} }`
    const data = await gql<Record<string, Raw>>('PulseDashSeasonStats', query, {}, signal)
    for (const n of batch) {
      const q = data[`t${n}`]?.quickStats
      if (!q) continue
      const dc = stat(q.dc)
      const eg = stat(q.eg)
      out[n] = {
        total: stat(q.tot),
        auto: stat(q.auto),
        teleop: { value: dc.value == null ? null : dc.value + (eg.value ?? 0), rank: eg.value ? null : dc.rank },
        count: num(q.count),
      }
    }
  }
  return out
}

const EVENT_LIST = `query EventsSearch($season: Int!) {
  eventsSearch(season: $season) { season code name type start end remote location { city state country } }
}`

export async function fetchEventList(season: number, signal?: AbortSignal): Promise<EventSummary[]> {
  const data = await gql<{ eventsSearch: Raw[] }>('EventsSearch', EVENT_LIST, { season }, signal)
  return (data.eventsSearch ?? []).map(toSummary)
}

function toSummary(e: Raw): EventSummary {
  return {
    season: e.season,
    code: e.code,
    name: str(e.name) ?? e.code,
    type: str(e.type),
    start: str(e.start)?.slice(0, 10) ?? null,
    end: str(e.end)?.slice(0, 10) ?? null,
    city: str(e.location?.city),
    state: str(e.location?.state),
    country: str(e.location?.country),
    remote: Boolean(e.remote),
  }
}

const TEAM_EVENTS = `query PulseDashTeamEvents($number: Int!, $season: Int!) {
  teamByNumber(number: $number) {
    number name location { city state country }
    events(season: $season) { event { season code name type start end remote location { city state country } } }
  }
}`

export interface TeamLookup {
  number: number
  name: string | null
  place: string | null
  events: EventSummary[]
}

export async function fetchTeamEvents(team: number, season: number, signal?: AbortSignal): Promise<TeamLookup | null> {
  const data = await gql<{ teamByNumber: Raw }>('PulseDashTeamEvents', TEAM_EVENTS, { number: team, season }, signal)
  const t = data.teamByNumber
  if (!t) return null
  return {
    number: t.number,
    name: str(t.name),
    place: [t.location?.city, t.location?.state, t.location?.country].filter(Boolean).join(', ') || null,
    events: (t.events ?? []).map((e: Raw) => e.event).filter(Boolean).map(toSummary),
  }
}
