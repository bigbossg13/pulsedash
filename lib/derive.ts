// Pure functions that turn a normalized event snapshot into what the pit
// display shows: the team's next match, how far the event is running behind,
// when to queue, records and score predictions.
import type { AllianceColor, AllianceSelection, Match, Ranking, SeasonStats, TeamStats } from './types'

const MINUTE = 60_000
const DEFAULT_CYCLE = 6 * MINUTE

const LEVEL_ORDER = { qual: 0, playoff: 1 } as const

/** Schedule order: qualifications first, then playoffs, each by scheduled time and number. */
export function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    if (a.level !== b.level) return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    if (a.scheduled != null && b.scheduled != null && a.scheduled !== b.scheduled) return a.scheduled - b.scheduled
    return a.series - b.series || a.number - b.number
  })
}

export function allianceOf(match: Match, team: number): AllianceColor | null {
  return match.teams.find(t => t.team === team)?.alliance ?? null
}

export function teamMatches(sorted: Match[], team: number): Match[] {
  return sorted.filter(m => m.teams.some(t => t.team === team))
}

export function winner(match: Match): AllianceColor | 'tie' | null {
  if (!match.played || !match.red || !match.blue) return null
  if (match.red.total === match.blue.total) return 'tie'
  return match.red.total > match.blue.total ? 'red' : 'blue'
}

export type Result = 'win' | 'loss' | 'tie'

export function resultFor(match: Match, team: number): Result | null {
  const side = allianceOf(match, team)
  const w = winner(match)
  if (!side || !w) return null
  if (w === 'tie') return 'tie'
  return w === side ? 'win' : 'loss'
}

export function record(sorted: Match[], team: number, level: Match['level'] = 'qual') {
  const r = { wins: 0, losses: 0, ties: 0 }
  for (const m of sorted) {
    if (m.level !== level) continue
    const res = resultFor(m, team)
    if (res === 'win') r.wins++
    else if (res === 'loss') r.losses++
    else if (res === 'tie') r.ties++
  }
  return r
}

/** Partners and opponents of `team` in a match, on-field teams first. */
export function sides(match: Match, team: number | null) {
  const mine = team != null ? allianceOf(match, team) : null
  const byAlliance = (a: AllianceColor) =>
    match.teams
      .filter(t => t.alliance === a)
      .sort((x, y) => Number(y.onField) - Number(x.onField) || x.station - y.station)
  const red = byAlliance('red')
  const blue = byAlliance('blue')
  return {
    alliance: mine,
    red,
    blue,
    partners: mine ? (mine === 'red' ? red : blue).filter(t => t.team !== team) : [],
    opponents: mine ? (mine === 'red' ? blue : red) : [],
  }
}

export function lastPlayed(sorted: Match[]): Match | null {
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].played) return sorted[i]
  return null
}

/** Index of the next match to be played on the field: the first unplayed match after the last played one. */
export function nextOnFieldIndex(sorted: Match[]): number {
  const last = sorted.findLastIndex(m => m.played)
  return sorted.findIndex((m, i) => i > last && !m.played)
}

export function nextOnField(sorted: Match[]): Match | null {
  return sorted[nextOnFieldIndex(sorted)] ?? null
}

/** Median spacing between consecutive scheduled matches (the field's cycle time). */
export function cycleTime(sorted: Match[]): number {
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].scheduled
    const b = sorted[i].scheduled
    if (a == null || b == null) continue
    const gap = b - a
    if (gap > 0 && gap <= 20 * MINUTE) gaps.push(gap)
  }
  if (!gaps.length) return DEFAULT_CYCLE
  gaps.sort((x, y) => x - y)
  return gaps[Math.floor(gaps.length / 2)]
}

export interface Timing {
  /** How far behind (positive) or ahead (negative) the next match is running, in ms. Null when unknown. */
  delay: number | null
  /** Estimated start of each unplayed match, keyed by match key. */
  estimates: Map<string, number>
  cycle: number
}

/**
 * Estimates when upcoming matches will start. The current delay comes from the
 * last played match (actual vs scheduled start) and from the next match being
 * overdue. Gaps in the schedule longer than one cycle (breaks, lunch,
 * overnight) absorb delay, so a late morning doesn't push out the afternoon.
 */
export function estimateTiming(sorted: Match[], now: number): Timing {
  const cycle = cycleTime(sorted)
  const estimates = new Map<string, number>()
  const nextIndex = nextOnFieldIndex(sorted)
  if (nextIndex < 0) return { delay: null, estimates, cycle }
  const next = sorted[nextIndex]

  let observed: number | null = null
  let observedFrom: number | null = null
  for (let i = nextIndex - 1; i >= 0; i--) {
    const m = sorted[i]
    if (m.played && m.scheduled != null && m.actual != null) {
      observed = m.actual - m.scheduled
      observedFrom = m.scheduled
      break
    }
  }
  if (observed != null && observedFrom != null && next.scheduled != null) {
    observed = absorb(observed, next.scheduled - observedFrom, cycle * Math.max(1, countBetween(sorted, observedFrom, next.scheduled)))
  }
  const overdue = next.scheduled != null && now > next.scheduled ? now - next.scheduled : null

  let delay: number | null = null
  if (observed != null || overdue != null) {
    delay = Math.max(observed ?? -Infinity, overdue ?? -Infinity)
    delay = Math.max(delay, -15 * MINUTE)
  }

  let d = delay ?? 0
  let prev: Match | null = null
  for (let i = nextIndex; i < sorted.length; i++) {
    const m = sorted[i]
    if (m.played || m.scheduled == null) continue
    if (prev?.scheduled != null) d = absorb(d, m.scheduled - prev.scheduled, cycle)
    let est = m.scheduled + d
    if (m === next) est = Math.max(est, now)
    estimates.set(m.key, est)
    prev = m
  }
  return { delay, estimates, cycle }
}

function countBetween(sorted: Match[], from: number, to: number): number {
  return sorted.filter(m => m.scheduled != null && m.scheduled > from && m.scheduled <= to).length
}

/** A positive delay shrinks by however much a gap exceeds the expected spacing. */
function absorb(delay: number, gap: number, expected: number): number {
  if (delay <= 0) return delay
  const slack = gap - expected
  return slack > 0 ? Math.max(0, delay - slack) : delay
}

export type QueueKind = 'none' | 'later' | 'soon' | 'now' | 'on-field'

export interface QueueStatus {
  kind: QueueKind
  match: Match | null
  /** Unplayed matches before this one. */
  matchesAway: number | null
  estimatedStart: number | null
  queueAt: number | null
}

export interface QueueRules {
  /** Queue this many minutes before the estimated start (0 = off). */
  leadMinutes: number
  /** ...or when this many matches or fewer are ahead (0 = off). */
  leadMatches: number
  adjustForDelay: boolean
}

export function queueStatus(sorted: Match[], team: number, timing: Timing, now: number, rules: QueueRules): QueueStatus {
  const fieldIdx = nextOnFieldIndex(sorted)
  const nextIdx = fieldIdx < 0 ? -1 : sorted.findIndex((m, i) => i >= fieldIdx && !m.played && m.teams.some(t => t.team === team))
  if (nextIdx < 0) {
    return { kind: 'none', match: null, matchesAway: null, estimatedStart: null, queueAt: null }
  }
  const match = sorted[nextIdx]
  const matchesAway = sorted.slice(fieldIdx, nextIdx).filter(m => !m.played).length
  const estimatedStart = rules.adjustForDelay
    ? timing.estimates.get(match.key) ?? match.scheduled
    : match.scheduled
  const queueAt = estimatedStart != null && rules.leadMinutes > 0 ? estimatedStart - rules.leadMinutes * MINUTE : null

  let kind: QueueKind = 'later'
  if (matchesAway === 0 && (estimatedStart == null || now >= estimatedStart - MINUTE)) kind = 'on-field'
  else if ((queueAt != null && now >= queueAt) || (rules.leadMatches > 0 && matchesAway != null && matchesAway <= rules.leadMatches)) kind = 'now'
  else if (queueAt != null && now >= queueAt - 5 * MINUTE) kind = 'soon'
  return { kind, match, matchesAway, estimatedStart, queueAt }
}

export type OprKind = 'np' | 'total'

/** Best available OPR for a team: event stats, then earlier-event preview, then season stats. */
export function teamOpr(team: number, stats: Record<number, TeamStats>, season: Record<number, SeasonStats>, kind: OprKind): number | null {
  const s = stats[team]
  const fromEvent = kind === 'np' ? s?.npOpr ?? s?.opr : s?.opr ?? s?.npOpr
  if (fromEvent != null) return fromEvent
  return season[team]?.total.value ?? null
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

export interface Prediction {
  red: number | null
  blue: number | null
  /** Chance red wins, 0–1. Null when either alliance has no estimate. */
  redWin: number | null
  /** On-field teams with no stats; the estimate leaves them out. */
  missing: number[]
}

/** Predicts alliance scores as the sum of on-field teams' OPR. */
export function predict(match: Match, stats: Record<number, TeamStats>, season: Record<number, SeasonStats>, kind: OprKind): Prediction {
  const missing: number[] = []
  let variance = 0
  const total = (alliance: AllianceColor) => {
    let sum: number | null = null
    for (const t of match.teams) {
      if (t.alliance !== alliance || !t.onField) continue
      const opr = teamOpr(t.team, stats, season, kind)
      if (opr == null) {
        missing.push(t.team)
        continue
      }
      sum = (sum ?? 0) + opr
      const dev = stats[t.team]?.dev
      variance += dev != null ? dev * dev : Math.pow(Math.max(opr, 10) * 0.35, 2)
    }
    return sum
  }
  const red = total('red')
  const blue = total('blue')
  let redWin: number | null = null
  if (red != null && blue != null) {
    const sigma = Math.max(Math.sqrt(variance), 5)
    redWin = normalCdf((red - blue) / sigma)
  }
  return { red, blue, redWin, missing }
}

/** 1-based rank of each team by event OPR (only teams with event-level stats). */
export function oprRanks(stats: Record<number, TeamStats>, kind: OprKind): Map<number, number> {
  const rows = Object.entries(stats)
    .filter(([, s]) => s.source === 'event')
    .map(([team, s]) => [Number(team), kind === 'np' ? s.npOpr ?? s.opr : s.opr ?? s.npOpr] as const)
    .filter((r): r is readonly [number, number] => r[1] != null)
    .sort((a, b) => b[1] - a[1])
  return new Map(rows.map(([team], i) => [team, i + 1]))
}

/**
 * Rebuilds playoff alliances from playoff match rosters when the official
 * alliance list isn't available. Seeds are unknown, so alliances are ordered
 * by their captain's qualification rank.
 */
export function alliancesFromMatches(sorted: Match[], rankings: Ranking[]): AllianceSelection[] {
  const byCaptain = new Map<number, Set<number>>()
  for (const m of sorted) {
    if (m.level !== 'playoff') continue
    for (const color of ['red', 'blue'] as const) {
      const members = m.teams.filter(t => t.alliance === color).sort((a, b) => a.station - b.station)
      const captain = members.find(t => t.station === 1)?.team ?? members[0]?.team
      if (captain == null) continue
      const set = byCaptain.get(captain) ?? new Set<number>([captain])
      for (const t of members) set.add(t.team)
      byCaptain.set(captain, set)
    }
  }
  const rankOf = new Map(rankings.map(r => [r.team, r.rank]))
  return [...byCaptain.entries()]
    .sort(([a], [b]) => (rankOf.get(a) ?? 9999) - (rankOf.get(b) ?? 9999) || a - b)
    .map(([captain, set]) => ({ number: null, name: `Alliance led by ${captain}`, teams: [...set] }))
}

/** Ordinal suffix: 1st, 2nd, 3rd, 11th. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
