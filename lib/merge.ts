// Combines what FTCScout and the FTC Events API returned into one snapshot.
//
// - Matches and rankings: the official API is first-hand and updates within
//   seconds, so it wins when it has at least as many played matches as
//   FTCScout (which syncs about once a minute). Otherwise FTCScout is used.
// - OPR and score predictions only exist in FTCScout.
// - Team and event details: official values first, FTCScout fills the gaps.
import type { EventInfo, EventSnapshot, Match, SeasonStats, Source, SourceData, SourceStatus, TeamInfo } from './types'
import { alliancesFromMatches, sortMatches } from './derive'

const played = (m: Match[] | undefined) => m?.filter(x => x.played).length ?? 0

function pickMatches(scout?: Match[], official?: Match[]): { matches: Match[]; from: Source | null } {
  const hasScout = !!scout?.length
  const hasOfficial = !!official?.length
  if (hasOfficial && (!hasScout || played(official) >= played(scout))) return { matches: official!, from: 'ftcEvents' }
  if (hasScout) return { matches: scout!, from: 'ftcscout' }
  return { matches: [], from: null }
}

function mergeRecord<T extends object>(base: T | null | undefined, over: T | null | undefined): T | null {
  if (!base) return over ?? null
  if (!over) return base
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(over)) if (v != null && v !== '') out[k] = v
  return out as T
}

export function mergeTeams(scout: Record<number, TeamInfo> = {}, official: Record<number, TeamInfo> = {}): Record<number, TeamInfo> {
  const out: Record<number, TeamInfo> = { ...scout }
  for (const [n, t] of Object.entries(official)) out[Number(n)] = mergeRecord(out[Number(n)], t)!
  return out
}

export function mergeSnapshot(
  scout: SourceData | null,
  official: SourceData | null,
  seasonStats: Record<number, SeasonStats>,
  sources: Record<Source, SourceStatus>,
): EventSnapshot {
  const { matches, from } = pickMatches(scout?.matches, official?.matches)
  const sorted = sortMatches(matches)
  const officialRankings = official?.rankings?.length ? official.rankings : null
  const rankings = officialRankings ?? scout?.rankings ?? []
  const officialAlliances = official?.alliances?.length ? official.alliances : null
  const alliances = officialAlliances ?? alliancesFromMatches(sorted, rankings)
  const teams = mergeTeams(scout?.teams, official?.teams)
  // Teams that only appear in the schedule still get a row.
  for (const m of sorted) for (const t of m.teams) teams[t.team] ??= { number: t.team, name: null, city: null, state: null, country: null, rookieYear: null }
  return {
    event: mergeRecord<EventInfo>(scout?.event, official?.event),
    teams,
    matches: sorted,
    rankings,
    stats: scout?.stats ?? {},
    seasonStats,
    alliances,
    provenance: {
      matches: from,
      rankings: officialRankings ? 'ftcEvents' : scout?.rankings?.length ? 'ftcscout' : null,
      alliances: officialAlliances ? 'ftcEvents' : alliances.length ? from : null,
    },
    sources,
  }
}
