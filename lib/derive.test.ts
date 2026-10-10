import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Match, TeamStats } from './types'
import {
  alliancesFromMatches, estimateTiming, nextOnField, normalCdf, ordinal, predict, queueStatus, record, resultFor,
  sides, sortMatches,
} from './derive'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 10, 16, 0)

function qual(n: number, opts: { red?: number[]; blue?: number[]; played?: boolean; delay?: number; score?: [number, number]; at?: number } = {}): Match {
  const red = opts.red ?? [n * 10 + 1, n * 10 + 2]
  const blue = opts.blue ?? [n * 10 + 3, n * 10 + 4]
  const scheduled = opts.at ?? T0 + (n - 1) * 6 * MIN
  const played = opts.played ?? false
  const [r, b] = opts.score ?? [100, 80]
  return {
    key: `qual-${n}`,
    level: 'qual',
    series: 0,
    number: n,
    label: `Q${n}`,
    longLabel: `Qualification ${n}`,
    scheduled,
    actual: played ? scheduled + (opts.delay ?? 0) : null,
    posted: null,
    played,
    field: null,
    teams: [
      ...red.map((team, i) => ({ team, alliance: 'red' as const, station: i + 1, onField: true, surrogate: false, noShow: false, dq: false })),
      ...blue.map((team, i) => ({ team, alliance: 'blue' as const, station: i + 1, onField: true, surrogate: false, noShow: false, dq: false })),
    ],
    red: played ? { total: r, auto: null, teleop: null, penalty: null } : null,
    blue: played ? { total: b, auto: null, teleop: null, penalty: null } : null,
  }
}

test('sortMatches puts qualifications before playoffs and orders by time', () => {
  const p: Match = { ...qual(1), key: 'p1', level: 'playoff', scheduled: T0 - MIN }
  const sorted = sortMatches([qual(3), p, qual(1), qual(2)])
  assert.deepEqual(sorted.map(m => m.key), ['qual-1', 'qual-2', 'qual-3', 'p1'])
})

test('results and records follow the team alliance', () => {
  const ms = sortMatches([
    qual(1, { red: [1, 2], blue: [3, 4], played: true, score: [100, 80] }),
    qual(2, { red: [3, 1], blue: [5, 6], played: true, score: [50, 90] }),
    qual(3, { red: [7, 8], blue: [1, 9], played: true, score: [70, 70] }),
    qual(4, { red: [1, 2], blue: [3, 4] }),
  ])
  assert.equal(resultFor(ms[0], 1), 'win')
  assert.equal(resultFor(ms[0], 3), 'loss')
  assert.equal(resultFor(ms[3], 1), null)
  assert.deepEqual(record(ms, 1), { wins: 1, losses: 1, ties: 1 })
  const s = sides(ms[1], 1)
  assert.equal(s.alliance, 'red')
  assert.deepEqual(s.partners.map(t => t.team), [3])
  assert.deepEqual(s.opponents.map(t => t.team), [5, 6])
})

test('delay comes from the last played match and carries to upcoming ones', () => {
  const ms = sortMatches([
    qual(1, { played: true, delay: 5 * MIN }),
    qual(2, { played: true, delay: 8 * MIN }),
    qual(3),
    qual(4),
  ])
  const now = T0 + 6 * MIN + 8 * MIN + 3 * MIN // Q2 started 8 min late and is over
  const t = estimateTiming(ms, now)
  assert.equal(t.delay, 8 * MIN)
  assert.equal(nextOnField(ms)?.key, 'qual-3')
  assert.equal(t.estimates.get('qual-3'), ms[2].scheduled! + 8 * MIN)
  assert.equal(t.estimates.get('qual-4'), ms[3].scheduled! + 8 * MIN)
})

test('an overdue next match raises the delay estimate', () => {
  const ms = sortMatches([qual(1, { played: true, delay: 0 }), qual(2), qual(3)])
  const now = ms[1].scheduled! + 12 * MIN
  const t = estimateTiming(ms, now)
  assert.equal(t.delay, 12 * MIN)
  assert.equal(t.estimates.get('qual-2'), now)
})

test('a break in the schedule absorbs the delay', () => {
  const ms = sortMatches([
    qual(1, { played: true, delay: 10 * MIN }),
    qual(2),
    qual(3, { at: T0 + 6 * MIN + 60 * MIN }), // lunch break before Q3
  ])
  const t = estimateTiming(ms, T0 + 12 * MIN)
  assert.equal(t.estimates.get('qual-2'), ms[1].scheduled! + 10 * MIN)
  assert.equal(t.estimates.get('qual-3'), ms[2].scheduled!)
})

test('no timing information means no delay', () => {
  const ms = sortMatches([qual(1), qual(2)])
  const t = estimateTiming(ms, T0 - 30 * MIN)
  assert.equal(t.delay, null)
  assert.equal(t.estimates.get('qual-1'), T0)
})

test('queue status counts matches away and applies the lead time', () => {
  const ms = sortMatches([qual(1, { played: true }), qual(2), qual(3), qual(4, { red: [99, 98] }), qual(5)])
  const rules = { leadMinutes: 10, leadMatches: 0, adjustForDelay: true }
  const early = queueStatus(ms, 99, estimateTiming(ms, T0 + MIN), T0 + MIN, rules)
  assert.equal(early.match?.key, 'qual-4')
  assert.equal(early.matchesAway, 2)
  assert.equal(early.kind, 'later')
  const q4 = ms[3].scheduled!
  assert.equal(queueStatus(ms, 99, estimateTiming(ms, q4 - 13 * MIN), q4 - 13 * MIN, rules).kind, 'soon')
  // Q2 is now 3 minutes overdue, which pushes Q4's estimate (and queue time) back.
  assert.equal(queueStatus(ms, 99, estimateTiming(ms, q4 - 9 * MIN), q4 - 9 * MIN, rules).kind, 'soon')
  assert.equal(queueStatus(ms, 99, estimateTiming(ms, q4 - 9 * MIN), q4 - 9 * MIN, { ...rules, adjustForDelay: false }).kind, 'now')
  const onTime = sortMatches([qual(1, { played: true }), qual(2, { played: true }), qual(3, { played: true }), qual(4, { red: [99, 98] })])
  assert.equal(queueStatus(onTime, 99, estimateTiming(onTime, q4 - 9 * MIN), q4 - 9 * MIN, rules).kind, 'now')
  assert.equal(queueStatus(ms, 99, estimateTiming(ms, T0 + MIN), T0 + MIN, { ...rules, leadMatches: 2 }).kind, 'now')
  assert.equal(queueStatus(ms, 12345, estimateTiming(ms, T0), T0, rules).kind, 'none')
})

test('queue status reports on-field when the team is next up', () => {
  const ms = sortMatches([qual(1, { played: true }), qual(2, { red: [99, 98] })])
  const now = ms[1].scheduled! + 30_000
  const s = queueStatus(ms, 99, estimateTiming(ms, now), now, { leadMinutes: 10, leadMatches: 2, adjustForDelay: true })
  assert.equal(s.kind, 'on-field')
  assert.equal(s.matchesAway, 0)
})

test('predictions add on-field OPR and favour the stronger alliance', () => {
  const m = qual(1, { red: [1, 2], blue: [3, 4] })
  const stat = (npOpr: number): TeamStats => ({ opr: npOpr, npOpr, autoOpr: null, teleopOpr: null, avg: null, dev: 10, source: 'event' })
  const p = predict(m, { 1: stat(60), 2: stat(40), 3: stat(30), 4: stat(20) }, {}, 'np')
  assert.equal(p.red, 100)
  assert.equal(p.blue, 50)
  assert.ok(p.redWin! > 0.9)
  const partial = predict(m, { 1: stat(60), 3: stat(30) }, {}, 'np')
  assert.deepEqual(partial.missing.sort(), [2, 4])
})

test('normalCdf is symmetric', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6)
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3)
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3)
})

test('alliances are rebuilt from playoff rosters', () => {
  const p1: Match = { ...qual(1, { red: [10, 20, 30], blue: [40, 50] }), key: 'p1', level: 'playoff' }
  const p2: Match = { ...qual(2, { red: [40, 50, 60], blue: [10, 20] }), key: 'p2', level: 'playoff' }
  const alliances = alliancesFromMatches([p1, p2], [{ team: 40, rank: 1, rankingScore: null, tiebreaker: null, wins: null, losses: null, ties: null, played: null }])
  assert.deepEqual(alliances.map(a => a.teams), [[40, 50, 60], [10, 20, 30]])
})

test('ordinal suffixes', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st'])
})
