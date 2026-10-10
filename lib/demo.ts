// A made-up event that plays out in real time, for trying the display
// without a live competition (and for off-season testing). Team numbers are
// in the 90000s, which FIRST hasn't issued.
import type { AllianceScore, AllianceSelection, EventInfo, Match, MatchTeam, Ranking, SeasonStats, SourceData, TeamInfo, TeamStats } from './types'

export const DEMO_CODE = 'DEMO'
export const DEMO_TEAM = 90007

const MINUTE = 60_000
const CYCLE = 6 * MINUTE
const MATCH_LENGTH = 2.5 * MINUTE
const NAMES = [
  'Alpha', 'Bravo', 'Comet', 'Delta', 'Ember', 'Falcon', 'Glacier', 'Harbor', 'Ion', 'Jetstream', 'Kestrel', 'Lumen',
  'Meteor', 'Nova', 'Orbit', 'Prism', 'Quasar', 'Rocket', 'Summit', 'Tundra', 'Umbra', 'Vector', 'Willow', 'Zephyr',
]
const TEAMS = NAMES.map((_, i) => 90001 + i)
const ROUNDS = 5

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const strengthOf = (() => {
  const r = rng(7)
  return new Map(TEAMS.map(n => [n, Math.round(35 + r() * 95)]))
})()

function schedule(): number[][] {
  const r = rng(13)
  const rounds: number[][] = []
  for (let round = 0; round < ROUNDS; round++) {
    const order = [...TEAMS].sort(() => r() - 0.5)
    for (let i = 0; i < order.length; i += 4) rounds.push(order.slice(i, i + 4))
  }
  return rounds
}

const SCHEDULE = schedule()

/**
 * Builds the demo event as it looks at `now`, for a schedule that began
 * shortly before `start` (the moment the demo was opened). The field runs a
 * few minutes behind so the delay estimate has something to show.
 */
export function demoData(start: number, now: number): { scout: SourceData; official: SourceData; seasonStats: Record<number, SeasonStats> } {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const first = Math.floor((start - 32 * MINUTE) / MINUTE) * MINUTE
  const day = new Date(start).toISOString().slice(0, 10)
  const event: EventInfo = {
    season: new Date(start).getUTCMonth() >= 8 ? new Date(start).getUTCFullYear() : new Date(start).getUTCFullYear() - 1,
    code: DEMO_CODE,
    name: 'PulseDash Demo Qualifier',
    start: day,
    end: day,
    timezone,
    venue: 'Demo High School',
    city: 'Sample City',
    state: 'CA',
    country: 'USA',
    type: 'Qualifier',
    liveStreamUrl: null,
    website: null,
    fieldCount: 1,
    remote: false,
  }

  const r = rng(99)
  const matches: Match[] = SCHEDULE.map((four, i) => {
    const scheduled = first + i * CYCLE
    const actual = scheduled + Math.round(Math.min(7, 2 + i * 0.4)) * MINUTE
    const played = now >= actual + MATCH_LENGTH
    const teams: MatchTeam[] = four.map((team, j) => ({
      team,
      alliance: j < 2 ? 'red' : 'blue',
      station: (j % 2) + 1,
      onField: true,
      surrogate: false,
      noShow: false,
      dq: false,
    }))
    const score = (pair: number[]) => {
      const auto = Math.round(pair.reduce((s, n) => s + strengthOf.get(n)! * 0.3, 0) * (0.8 + r() * 0.4))
      const teleop = Math.round(pair.reduce((s, n) => s + strengthOf.get(n)! * 0.7, 0) * (0.8 + r() * 0.4))
      const penalty = r() < 0.3 ? Math.round(r() * 3) * 5 : 0
      return { total: auto + teleop + penalty, auto, teleop, penalty }
    }
    const red = score(four.slice(0, 2))
    const blue = score(four.slice(2))
    return {
      key: `qual-QUALIFICATION-0-${i + 1}`,
      level: 'qual',
      series: 0,
      number: i + 1,
      label: `Q${i + 1}`,
      longLabel: `Qualification ${i + 1}`,
      scheduled,
      actual: now >= actual ? actual : null,
      posted: played ? actual + MATCH_LENGTH : null,
      played,
      field: '1',
      teams,
      red: played ? red : null,
      blue: played ? blue : null,
    }
  })

  const teams: Record<number, TeamInfo> = Object.fromEntries(
    TEAMS.map((n, i) => [n, { number: n, name: `Team ${NAMES[i]}`, city: 'Sample City', state: 'CA', country: 'USA', rookieYear: 2015 + (i % 11) }]),
  )

  const tally = new Map<number, { rp: number; np: number; w: number; l: number; t: number; n: number }>()
  for (const m of matches) {
    const { red, blue } = m
    if (!m.played || !red || !blue) continue
    for (const p of m.teams) {
      const mine: AllianceScore = p.alliance === 'red' ? red : blue
      const theirs: AllianceScore = p.alliance === 'red' ? blue : red
      const row = tally.get(p.team) ?? { rp: 0, np: 0, w: 0, l: 0, t: 0, n: 0 }
      const result = mine.total > theirs.total ? 'w' : mine.total < theirs.total ? 'l' : 't'
      row[result]++
      row.rp += result === 'w' ? 3 : result === 't' ? 1 : 0
      row.rp += mine.total - (mine.penalty ?? 0) > 150 ? 1 : 0
      row.np += mine.total - (mine.penalty ?? 0)
      row.n++
      tally.set(p.team, row)
    }
  }
  const rankings: Ranking[] = [...tally.entries()]
    .map(([team, s]) => ({
      team,
      rank: 0,
      rankingScore: Math.round((s.rp / s.n) * 100) / 100,
      tiebreaker: Math.round((s.np / s.n) * 10) / 10,
      wins: s.w,
      losses: s.l,
      ties: s.t,
      played: s.n,
    }))
    .sort((a, b) => b.rankingScore - a.rankingScore || b.tiebreaker - a.tiebreaker || a.team - b.team)
    .map((row, i) => ({ ...row, rank: i + 1 }))

  const stats: Record<number, TeamStats> = {}
  const noise = rng(5)
  for (const n of TEAMS) {
    const base = strengthOf.get(n)!
    const playedAny = tally.has(n)
    const npOpr = Math.round(base * (playedAny ? 0.9 + noise() * 0.2 : 0.95) * 10) / 10
    stats[n] = {
      opr: Math.round((npOpr + 4) * 10) / 10,
      npOpr,
      autoOpr: Math.round(npOpr * 0.3 * 10) / 10,
      teleopOpr: Math.round(npOpr * 0.7 * 10) / 10,
      avg: npOpr * 1.6,
      dev: 18,
      source: playedAny ? 'event' : 'preview',
    }
  }

  const seasonStats: Record<number, SeasonStats> = {}
  const byStrength = [...TEAMS].sort((a, b) => strengthOf.get(b)! - strengthOf.get(a)!)
  for (const n of TEAMS) {
    const v = strengthOf.get(n)!
    const rank = 40 + byStrength.indexOf(n) * 180
    seasonStats[n] = {
      total: { value: v, rank },
      auto: { value: Math.round(v * 0.3), rank },
      teleop: { value: Math.round(v * 0.7), rank },
      count: 4800,
    }
  }

  const alliances: AllianceSelection[] = []
  return {
    scout: { event, teams, stats, matches, rankings },
    official: { event, matches, rankings, alliances },
    seasonStats,
  }
}
