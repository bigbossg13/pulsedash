import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Match } from './types'
import { applyNexus, defaultNexusKey, findNexusMatch, nexusBase, nexusDelay, nexusOnField, normalizeNexus } from './nexus'
import type { QueueStatus } from './derive'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 10, 16, 0)

const raw = {
  dataAsOfTime: NOW,
  nowQueuing: 'Qualification 14',
  matches: [
    { label: 'Practice 1', status: 'On field', redTeams: ['101', null], blueTeams: [null, null], times: {} },
    { label: 'Qualification 11', status: 'On field', redTeams: ['1', '2'], blueTeams: ['3', '4'], times: { scheduledStartTime: NOW - 20 * MIN } },
    { label: 'Qualification 12', status: 'On field', redTeams: ['5', '6'], blueTeams: ['7', '8'], times: { actualStartTime: NOW - MIN } },
    { label: 'Qualification 13', status: 'On deck', redTeams: ['9', '10'], blueTeams: ['11', '12'], times: { scheduledStartTime: NOW, estimatedStartTime: NOW + 6 * MIN } },
    { label: 'Qualification 14', status: 'Now queuing', redTeams: ['99', '13'], blueTeams: ['14', '15'], breakAfter: 'Lunch', times: { scheduledStartTime: NOW + 6 * MIN, estimatedStartTime: NOW + 12 * MIN, actualQueueTime: NOW - 30_000 } },
    { label: 'Qualification 15', status: 'Queuing soon', redTeams: ['16', '17'], blueTeams: ['18', '19'], times: { estimatedQueueTime: NOW, estimatedStartTime: NOW + 18 * MIN } },
  ],
  announcements: [{ id: 'a', announcement: 'Lunch at noon', postedTime: NOW - 5 * MIN }, { id: 'b', announcement: '  ' }],
  partsRequests: [{ id: 'p', parts: 'Need a hex shaft', requestedByTeam: '1234', postedTime: NOW - MIN }],
}

const match = (level: Match['level'], label: string, series: number, number: number): Match => ({
  key: label, level, series, number, label, longLabel: label, scheduled: null, actual: null, posted: null,
  played: false, field: null, teams: [], red: null, blue: null,
})

const queue = (m: Match): QueueStatus => ({ kind: 'later', match: m, matchesAway: 3, estimatedStart: NOW + 30 * MIN, queueAt: NOW + 20 * MIN })

test('normalizes the Nexus event feed', () => {
  const n = normalizeNexus('2026usxxq1', raw)
  assert.equal(n.nowQueuing, 'Qualification 14')
  assert.deepEqual(n.matches[0].red, [101, null])
  assert.equal(n.matches[4].breakAfter, 'Lunch')
  assert.deepEqual(n.announcements.map(a => a.text), ['Lunch at noon'])
  assert.equal(n.partsRequests[0].team, 1234)
})

test('the last "On field" match is the one on the field, and only while queuing', () => {
  const n = normalizeNexus('k', raw)
  assert.equal(nexusOnField(n)?.label, 'Qualification 12')
  assert.equal(nexusOnField({ ...n, nowQueuing: null }), null)
})

test('maps Nexus labels onto schedule matches', () => {
  const n = normalizeNexus('k', {
    ...raw,
    matches: [...raw.matches, { label: 'Playoff 3', status: 'Queuing soon' }, { label: 'Playoff 3 Replay', status: 'On deck' }, { label: 'Final 2', status: 'Queuing soon' }],
  })
  assert.equal(findNexusMatch(n, match('qual', 'Q14', 0, 14))?.label, 'Qualification 14')
  assert.equal(findNexusMatch(n, match('playoff', 'M3', 3, 1))?.label, 'Playoff 3')
  assert.equal(findNexusMatch(n, match('playoff', 'F2', 0, 2))?.label, 'Final 2')
  assert.equal(findNexusMatch(n, match('qual', 'Q99', 0, 99)), null)
})

test('Nexus queue calls override the estimate-based call', () => {
  const n = normalizeNexus('k', raw)
  const now = applyNexus(queue(match('qual', 'Q14', 0, 14)), n)
  assert.equal(now.kind, 'now')
  assert.equal(now.nexusStatus, 'Now queuing')
  assert.equal(now.estimatedStart, NOW + 12 * MIN)
  assert.equal(now.queueAt, NOW - 30_000)
  const deck = applyNexus(queue(match('qual', 'Q13', 0, 13)), n)
  assert.equal(deck.nexusStatus, 'On deck')
  assert.equal(applyNexus(queue(match('qual', 'Q12', 0, 12)), n).kind, 'on-field')
  // A stale "On field" (already played) is not the match on the field.
  assert.equal(applyNexus(queue(match('qual', 'Q11', 0, 11)), n).kind, 'later')
})

test('without nowQueuing, statuses are ignored but future estimates still help', () => {
  const n = normalizeNexus('k', { ...raw, nowQueuing: null })
  const q = applyNexus(queue(match('qual', 'Q14', 0, 14)), n)
  assert.equal(q.kind, 'later')
  assert.equal(q.nexusStatus, null)
  assert.equal(q.estimatedStart, NOW + 12 * MIN)
  // Estimates clamped to dataAsOfTime are not real times.
  const clamped = applyNexus(queue(match('qual', 'Q15', 0, 15)), n)
  assert.equal(clamped.queueAt, NOW + 20 * MIN)
})

test('delay, keys and request targets', () => {
  assert.equal(nexusDelay(normalizeNexus('k', raw)), 6 * MIN)
  assert.equal(defaultNexusKey(2026, 'USXXQ1'), '2026usxxq1')
  assert.deepEqual(nexusBase('abc', ''), { url: 'https://ftc.nexus/api/v1', headers: { 'Nexus-Api-Key': 'abc' } })
  assert.deepEqual(nexusBase('', 'https://p.dev/'), { url: 'https://p.dev/nexus/v1', headers: {} })
  assert.equal(nexusBase('', ''), null)
})
