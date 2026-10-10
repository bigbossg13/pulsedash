// Normalized data model for the PulseDash display. Both data sources (FTCScout
// and the official FTC Events API) are converted into these shapes so the UI
// never has to know where a value came from.

export type AllianceColor = 'red' | 'blue'
export type MatchLevel = 'qual' | 'playoff'

export interface MatchTeam {
  team: number
  alliance: AllianceColor
  /** Position within the alliance, 1-based. */
  station: number
  /** False for the playoff alliance member sitting out this match. */
  onField: boolean
  surrogate: boolean
  noShow: boolean
  dq: boolean
}

export interface AllianceScore {
  total: number
  auto: number | null
  /** Driver-controlled points, including endgame. */
  teleop: number | null
  /** Points this alliance received from the other alliance's fouls. */
  penalty: number | null
}

export interface Match {
  /** Stable within one source, e.g. "qual-0-12" or "playoff-3-1". */
  key: string
  level: MatchLevel
  series: number
  number: number
  /** Compact label for tables, e.g. "Q12", "M3", "F2". */
  label: string
  /** Spoken/readable label, e.g. "Qualification 12". */
  longLabel: string
  /** Epoch milliseconds. */
  scheduled: number | null
  actual: number | null
  posted: number | null
  played: boolean
  field: string | null
  teams: MatchTeam[]
  red: AllianceScore | null
  blue: AllianceScore | null
}

export interface Ranking {
  team: number
  rank: number
  /** Ranking score (RS): the primary sort order. */
  rankingScore: number | null
  /** First tiebreaker (TBP / average no-penalty score, depending on season). */
  tiebreaker: number | null
  wins: number | null
  losses: number | null
  ties: number | null
  played: number | null
}

/** Event-level performance from FTCScout. */
export interface TeamStats {
  /** Total OPR including penalty points. */
  opr: number | null
  /** OPR without penalty points: the better predictor. */
  npOpr: number | null
  autoOpr: number | null
  teleopOpr: number | null
  /** Average and standard deviation of the team's no-penalty match scores. */
  avg: number | null
  dev: number | null
  /**
   * "event": computed from matches at this event.
   * "preview": best result from an earlier event this season (before this event has matches).
   */
  source: 'event' | 'preview'
}

export interface StatWithRank {
  value: number | null
  rank: number | null
}

/** Season-wide OPR and world ranks from FTCScout. */
export interface SeasonStats {
  total: StatWithRank
  auto: StatWithRank
  teleop: StatWithRank
  /** Number of teams ranked worldwide. */
  count: number | null
}

export interface TeamInfo {
  number: number
  name: string | null
  city: string | null
  state: string | null
  country: string | null
  rookieYear: number | null
}

export interface EventInfo {
  season: number
  code: string
  name: string
  /** ISO dates (YYYY-MM-DD) in the event's time zone. */
  start: string | null
  end: string | null
  /** IANA time zone, e.g. "America/Chicago". */
  timezone: string | null
  venue: string | null
  city: string | null
  state: string | null
  country: string | null
  type: string | null
  liveStreamUrl: string | null
  website: string | null
  fieldCount: number | null
  remote: boolean
}

export interface AllianceSelection {
  /** Seed number; null when it can't be known (derived from FTCScout playoff matches). */
  number: number | null
  name: string
  /** Captain first, then picks in order. */
  teams: number[]
}

export type SourceState = 'off' | 'loading' | 'ok' | 'error'

export interface SourceStatus {
  state: SourceState
  /** When this source last returned data (epoch ms). */
  at: number | null
  message?: string
}

/** Everything one source returned for an event. All fields optional: sources fill what they can. */
export interface SourceData {
  event?: EventInfo | null
  teams?: Record<number, TeamInfo>
  matches?: Match[]
  rankings?: Ranking[]
  stats?: Record<number, TeamStats>
  alliances?: AllianceSelection[]
}

export interface EventSnapshot {
  /** Live queuing from FTC Nexus, when the event uses it. */
  nexus?: import('./nexus').NexusEvent | null
  event: EventInfo | null
  teams: Record<number, TeamInfo>
  matches: Match[]
  rankings: Ranking[]
  stats: Record<number, TeamStats>
  seasonStats: Record<number, SeasonStats>
  alliances: AllianceSelection[]
  /** Which source supplied the match list and rankings. */
  provenance: { matches: Source | null; rankings: Source | null; alliances: Source | null }
  sources: Record<Source, SourceStatus>
}

export type Source = 'ftcscout' | 'ftcEvents'

/** One row in the event picker. */
export interface EventSummary {
  season: number
  code: string
  name: string
  type: string | null
  start: string | null
  end: string | null
  city: string | null
  state: string | null
  country: string | null
  remote: boolean
}
