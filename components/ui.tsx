// Small building blocks shared by the widgets. Colour is never the only
// signal: alliances always say "Red"/"Blue", results say W/L/T, and the
// team's own rows are marked in text as well as highlighted.
import type { ReactNode } from 'react'
import type { AllianceColor, EventSnapshot, Match } from '@/lib/types'
import type { OprKind, QueueStatus, Result, Timing } from '@/lib/derive'
import type { PitPrefs } from '@/lib/settings'
import { teamOpr } from '@/lib/derive'

export interface DisplayCtx {
  snapshot: EventSnapshot
  team: number | null
  prefs: PitPrefs
  /** Ticks every second. */
  now: number
  timing: Timing
  queue: QueueStatus | null
  /** The team's matches in schedule order. */
  ours: Match[]
  /** Next match to be played on the field. */
  onField: Match | null
  timeZone: string | null
  oprRanks: Map<number, number>
  watch: Set<number>
  reducedMotion: boolean
}

export function teamName(ctx: DisplayCtx, n: number): string | null {
  return ctx.snapshot.teams[n]?.name ?? null
}

export function oprOf(ctx: DisplayCtx, n: number, kind: OprKind = ctx.prefs.opr): number | null {
  return teamOpr(n, ctx.snapshot.stats, ctx.snapshot.seasonStats, kind)
}

export const fmt = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(digits))

export function AllianceTag({ alliance, long = false }: { alliance: AllianceColor; long?: boolean }) {
  return (
    <span className={`alliance-tag ${alliance}`}>
      <svg viewBox="0 0 10 10" aria-hidden focusable={false}>
        {alliance === 'red' ? <rect width="10" height="10" rx="2" fill="currentColor" /> : <circle cx="5" cy="5" r="5" fill="currentColor" />}
      </svg>
      <span className="at-word">{alliance === 'red' ? 'Red' : 'Blue'}{long ? ' alliance' : ''}</span>
      <span className="at-letter" aria-hidden>{alliance === 'red' ? 'R' : 'B'}</span>
    </span>
  )
}

export function ResultBadge({ result, score }: { result: Result; score?: string }) {
  const letter = result === 'win' ? 'W' : result === 'loss' ? 'L' : 'T'
  const word = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Tie'
  return (
    <span className={`result ${result}`}>
      <span aria-hidden>{letter}</span>
      <span className="sr-only">{word}</span>
      {score ? <span className="score">{score}</span> : null}
    </span>
  )
}

export function TeamChip({ ctx, team, alliance, showOpr = true, flags }: {
  ctx: DisplayCtx
  team: number
  alliance?: AllianceColor
  showOpr?: boolean
  flags?: string[]
}) {
  const me = ctx.team === team
  const watch = !me && ctx.watch.has(team)
  const opr = oprOf(ctx, team)
  const name = teamName(ctx, team)
  return (
    <li className={`team-chip ${alliance ?? ''} ${me ? 'me' : ''} ${watch ? 'watch' : ''}`}>
      <span className="n">{team}</span>
      <span className="nm">
        {name ?? 'Unknown team'}
        {me ? <span className="sr-only"> (your team)</span> : null}
        {watch ? <span className="sr-only"> (watched)</span> : null}
      </span>
      {flags?.map(f => <span key={f} className="flag">{f}</span>)}
      {showOpr && opr != null ? <span className="opr" title="Offensive power rating">OPR {fmt(opr)}</span> : null}
    </li>
  )
}

/** Inline list of team numbers with the team and watched teams marked. */
export function TeamsInline({ ctx, teams }: { ctx: DisplayCtx; teams: number[] }) {
  return (
    <span className="teams-inline">
      {teams.map(n => {
        const me = n === ctx.team
        const watch = !me && ctx.watch.has(n)
        return (
          <span key={n} className={`t ${me ? 'me' : ''} ${watch ? 'watch' : ''}`}>
            {n}
            {me ? <span className="sr-only"> (you)</span> : null}
          </span>
        )
      })}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="widget-empty">
      <strong>{title}</strong>
      {children}
    </div>
  )
}

export function NeedsTeam() {
  return (
    <Empty title="Pick your team to see this">
      <span>Open Settings and enter your team number.</span>
    </Empty>
  )
}
