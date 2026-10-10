import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventQuery, normalizeEventData, parseSchema } from './ftcscout'
import { normalizeAlliances, normalizeRankings, normalizeSchedule, proxyBase } from './ftcevents'
import { mergeSnapshot } from './merge'
import { parseEventTime } from './time'
import type { SourceStatus } from './types'

const ok: SourceStatus = { state: 'ok', at: 0 }

test('FTC Events wall-clock times are read in the event time zone', () => {
  // 9:00 in Chicago during daylight time is 14:00 UTC.
  assert.equal(parseEventTime('2026-10-10T09:00:00', 'America/Chicago'), Date.UTC(2026, 9, 10, 14, 0))
  // ...and 15:00 UTC in standard time.
  assert.equal(parseEventTime('2026-12-05T09:00:00', 'America/Chicago'), Date.UTC(2026, 11, 5, 15, 0))
  assert.equal(parseEventTime('2026-10-10T09:00:00.5', 'UTC'), Date.UTC(2026, 9, 10, 9, 0, 0, 500))
  assert.equal(parseEventTime('2026-10-10T14:00:00Z', 'America/Chicago'), Date.UTC(2026, 9, 10, 14, 0))
  assert.equal(parseEventTime('0001-01-01T00:00:00', 'UTC'), null)
  assert.equal(parseEventTime(null), null)
})

test('the live query only asks for fields the season schema has', () => {
  const schema = parseSchema(2026, {
    tep: { name: 'TeamEventStats2026', fields: ['rank', 'rp', 'tb1', 'wins', 'losses', 'ties', 'qualMatchesPlayed', 'opr', 'avg', 'dev'].map(name => ({ name })) },
    tepTrad: null,
    group: { name: 'TeamEventStats2026Group', fields: ['totalPointsNp', 'totalPoints', 'autoPoints', 'dcPoints'].map(name => ({ name })) },
    groupTrad: null,
    ms: { name: 'MatchScores2026', fields: [{ name: 'red' }, { name: 'blue' }] },
    msTrad: null,
    msAlliance: { name: 'MatchScores2026Alliance', fields: ['totalPoints', 'autoPoints', 'dcPoints', 'penaltyPointsByOpp'].map(name => ({ name })) },
    event: { name: 'Event', fields: ['season', 'code', 'name', 'timezone', 'start', 'end'].map(name => ({ name })) },
    match: { name: 'Match', fields: ['id', 'series', 'matchNum', 'tournamentLevel', 'scheduledStartTime', 'hasBeenPlayed'].map(name => ({ name })) },
  })
  const q = eventQuery(schema)
  assert.match(q, /\.\.\. on TeamEventStats2026 \{ rank rp tb1 wins losses ties qualMatchesPlayed opr \{ totalPointsNp totalPoints autoPoints dcPoints \}/)
  assert.match(q, /\.\.\. on MatchScores2026 \{ red \{ totalPoints autoPoints dcPoints penaltyPointsByOpp \}/)
  assert.doesNotMatch(q, /egPoints|tb2|previewStats|liveStreamURL|actualStartTime/)
})

test('FTCScout event data normalizes teams, stats, rankings and matches', () => {
  const data = normalizeEventData({
    season: 2026, code: 'USXXQ1', name: 'Test Qualifier', timezone: 'America/Chicago', start: '2026-10-10', end: '2026-10-10',
    location: { venue: 'Gym', city: 'Austin', state: 'TX', country: 'USA' },
    teams: [
      { teamNumber: 1, team: { name: 'One', rookieYear: 2015, location: { city: 'A' } }, stats: { rank: 2, rp: 1.5, tb1: 80, wins: 1, losses: 1, ties: 0, qualMatchesPlayed: 2, opr: { totalPoints: 55, totalPointsNp: 50, autoPoints: 15, dcPoints: 35 }, dev: { totalPointsNp: 9 } } },
      { teamNumber: 2, team: { name: 'Two' }, stats: null },
    ],
    previewStats: [{ teamNumber: 2, npOpr: 42 }],
    matches: [
      {
        id: 12, series: 0, matchNum: 12, tournamentLevel: 'Quals', scheduledStartTime: '2026-10-10T15:00:00.000Z', hasBeenPlayed: true,
        teams: [
          { teamNumber: 1, alliance: 'Red', station: 'One', allianceRole: 'Captain', onField: true },
          { teamNumber: 2, alliance: 'Blue', station: 'One', allianceRole: 'Captain', onField: true },
        ],
        scores: { red: { totalPoints: 90, autoPoints: 20, dcPoints: 60, penaltyPointsByOpp: 10 }, blue: { totalPoints: 70, autoPoints: 10, dcPoints: 60, penaltyPointsByOpp: 0 } },
      },
      {
        id: 20003, series: 3, matchNum: 1, tournamentLevel: 'DoubleElim', hasBeenPlayed: false,
        teams: [{ teamNumber: 1, alliance: 'Red', station: 'NotOnField', allianceRole: 'SecondPick', onField: false }],
        scores: null,
      },
    ],
  })
  assert.equal(data.event?.city, 'Austin')
  assert.equal(data.teams?.[1].name, 'One')
  assert.equal(data.stats?.[1].npOpr, 50)
  assert.equal(data.stats?.[1].teleopOpr, 35)
  assert.equal(data.stats?.[2].source, 'preview')
  assert.deepEqual(data.rankings?.map(r => [r.team, r.rank, r.rankingScore]), [[1, 2, 1.5]])
  const [q12, m3] = data.matches!
  assert.equal(q12.label, 'Q12')
  assert.equal(q12.scheduled, Date.UTC(2026, 9, 10, 15, 0))
  assert.deepEqual(q12.red, { total: 90, auto: 20, teleop: 60, penalty: 10 })
  assert.equal(m3.label, 'M3')
  assert.equal(m3.level, 'playoff')
  assert.equal(m3.teams[0].station, 3)
  assert.equal(m3.teams[0].onField, false)
})

test('FTC Events schedule, rankings and alliances normalize', () => {
  const [q1, final] = normalizeSchedule([
    {
      description: 'Qualification 1', tournamentLevel: 'QUALIFICATION', series: 0, matchNumber: 1,
      startTime: '2026-10-10T09:00:00', actualStartTime: '2026-10-10T09:04:00', postResultTime: '2026-10-10T09:08:00',
      scoreRedFinal: 120, scoreRedAuto: 30, scoreRedFoul: 10, scoreBlueFinal: 90, scoreBlueAuto: 20, scoreBlueFoul: 0,
      teams: [
        { teamNumber: 11, station: 'Red1', surrogate: false, noShow: false, dq: false, onField: true },
        { teamNumber: 12, station: 'Red2', surrogate: true, noShow: false, dq: false, onField: true },
        { teamNumber: 13, station: 'Blue1' },
        { teamNumber: 14, station: 'Blue2' },
      ],
    },
    { description: 'Final 2', tournamentLevel: 'FINAL', series: 0, matchNumber: 2, startTime: '2026-10-10T15:00:00', teams: [] },
  ], 'America/Chicago')
  assert.equal(q1.label, 'Q1')
  assert.equal(q1.longLabel, 'Qualification 1')
  assert.equal(q1.scheduled, Date.UTC(2026, 9, 10, 14, 0))
  assert.equal(q1.actual, Date.UTC(2026, 9, 10, 14, 4))
  assert.equal(q1.played, true)
  assert.deepEqual(q1.red, { total: 120, auto: 30, penalty: 10, teleop: 80 })
  assert.equal(q1.teams[1].surrogate, true)
  assert.equal(q1.teams[3].alliance, 'blue')
  assert.equal(final.label, 'F2')
  assert.equal(final.played, false)

  const { rankings, teams } = normalizeRankings([
    { rank: 2, teamNumber: 12, teamName: 'Twelve', sortOrder1: 2.5, sortOrder2: 88, wins: 2, losses: 1, ties: 0, matchesPlayed: 3 },
    { rank: 1, teamNumber: 11, teamName: 'Eleven', sortOrder1: 3, sortOrder2: 90, wins: 3, losses: 0, ties: 0, matchesPlayed: 3 },
    { rank: 0, teamNumber: 99 },
  ])
  assert.deepEqual(rankings.map(r => r.team), [11, 12])
  assert.equal(rankings[1].rankingScore, 2.5)
  assert.equal(teams[12].name, 'Twelve')

  assert.deepEqual(normalizeAlliances([
    { number: 2, name: 'Alliance 2', captain: 13, round1: 14, round2: null },
    { number: 1, name: 'Alliance 1', captain: 11, round1: 12, round2: 15, backup: null },
  ]).map(a => [a.number, a.teams]), [[1, [11, 12, 15]], [2, [13, 14]]])
})

test('proxy URLs are normalized', () => {
  assert.equal(proxyBase('https://p.example.workers.dev/'), 'https://p.example.workers.dev')
  assert.equal(proxyBase('https://p.example.workers.dev/v2.0/'), 'https://p.example.workers.dev')
})

test('merge prefers the official schedule unless FTCScout is further along', () => {
  const m = (key: string, played: boolean) => ({
    key, level: 'qual' as const, series: 0, number: 1, label: key, longLabel: key, scheduled: 0, actual: null, posted: null,
    played, field: null, teams: [{ team: 5, alliance: 'red' as const, station: 1, onField: true, surrogate: false, noShow: false, dq: false }], red: null, blue: null,
  })
  const scout = { matches: [m('s1', true), m('s2', false)], rankings: [{ team: 5, rank: 1, rankingScore: 1, tiebreaker: 1, wins: 1, losses: 0, ties: 0, played: 1 }] }
  const both = mergeSnapshot(scout, { matches: [m('o1', true), m('o2', true)] }, {}, { ftcscout: ok, ftcEvents: ok })
  assert.equal(both.provenance.matches, 'ftcEvents')
  assert.equal(both.provenance.rankings, 'ftcscout')
  assert.equal(both.teams[5].number, 5)
  const behind = mergeSnapshot(scout, { matches: [m('o1', false), m('o2', false)] }, {}, { ftcscout: ok, ftcEvents: ok })
  assert.equal(behind.provenance.matches, 'ftcscout')
  const scoutOnly = mergeSnapshot(scout, null, {}, { ftcscout: ok, ftcEvents: { state: 'off', at: null } })
  assert.deepEqual(scoutOnly.matches.map(x => x.key), ['s1', 's2'])
})

test('a stale cached schema is dropped and the query retried once', async () => {
  const schema = {
    tep: null, tepTrad: null, group: null, groupTrad: null, ms: null, msTrad: null, msAlliance: null,
    event: { name: 'Event', fields: [{ name: 'code' }, { name: 'name' }] },
    match: { name: 'Match', fields: [{ name: 'id' }] },
  }
  const ops: string[] = []
  let failNext = true
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { operationName } = JSON.parse(String(init.body))
    ops.push(operationName)
    if (operationName === 'PulseDashSchema') return new Response(JSON.stringify({ data: schema }))
    if (failNext) {
      failNext = false
      return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "gone"' }] }), { status: 400 })
    }
    return new Response(JSON.stringify({ data: { eventByCode: { season: 2099, code: 'X', name: 'Retry Event', teams: [], matches: [] } } }))
  }) as typeof fetch
  try {
    const { fetchEventData } = await import('./ftcscout')
    const data = await fetchEventData(2099, 'X')
    assert.equal(data.event?.name, 'Retry Event')
    assert.deepEqual(ops, ['PulseDashSchema', 'PulseDashEventLive', 'PulseDashSchema', 'PulseDashEventLive'])
  } finally {
    globalThis.fetch = realFetch
  }
})
