'use client'
// The display's widgets. Each one reads the shared DisplayCtx and renders a
// self-contained section with its own heading, so screen-reader users can
// jump between them by heading.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Match } from '@/lib/types'
import type { WidgetId } from '@/lib/settings'
import { formatClock, formatDuration, formatRelative } from '@/lib/time'
import { allianceOf, ordinal, predict, record, resultFor, sides } from '@/lib/derive'
import { AllianceTag, Empty, NeedsTeam, ResultBadge, TeamChip, TeamsInline, fmt, oprOf, teamName, type DisplayCtx } from './ui'
import { BellIcon, ClockIcon, FieldIcon, PauseIcon, PlayIcon } from './icons'

export interface WidgetMeta {
  id: WidgetId
  title: string
  description: string
  needsTeam: boolean
  /** Share of the column's height compared to its neighbours. */
  grow: number
  /** Long content that scrolls inside the widget. */
  scrolls?: boolean
}

export const WIDGETS: Record<WidgetId, WidgetMeta> = {
  'next-match': { id: 'next-match', title: 'Next match', description: 'When to queue, your alliance, partners and opponents.', needsTeam: true, grow: 1.3 },
  'team-status': { id: 'team-status', title: 'Standing', description: 'Rank, ranking score, record and OPR.', needsTeam: true, grow: 1 },
  'match-preview': { id: 'match-preview', title: 'Match preview', description: 'Predicted score and win chance for your next match.', needsTeam: false, grow: 1 },
  'our-schedule': { id: 'our-schedule', title: 'Our matches', description: 'Every match for your team with times and results.', needsTeam: true, grow: 1.2, scrolls: true },
  'last-result': { id: 'last-result', title: 'Last result', description: 'Score breakdown of your most recent match.', needsTeam: true, grow: 1 },
  rankings: { id: 'rankings', title: 'Rankings', description: 'Full event rankings with your team highlighted.', needsTeam: false, grow: 2, scrolls: true },
  upcoming: { id: 'upcoming', title: 'Coming up on the field', description: 'The next matches at the event and their estimated start.', needsTeam: false, grow: 1.2, scrolls: true },
  alliances: { id: 'alliances', title: 'Alliances', description: 'Playoff alliances once selection is done.', needsTeam: false, grow: 0.8, scrolls: true },
  checklist: { id: 'checklist', title: 'Pre-match checklist', description: 'Your own checklist. It resets for every match.', needsTeam: false, grow: 1, scrolls: true },
  message: { id: 'message', title: 'Welcome', description: 'Your team message and logo for visitors.', needsTeam: false, grow: 1 },
}

export function Widget({ id, ctx }: { id: WidgetId; ctx: DisplayCtx }) {
  const meta = WIDGETS[id]
  const headingId = useId()
  const [paused, setPaused] = useState(false)
  const autoScroll = id === 'rankings' || id === 'upcoming'
  const title = id === 'message' && ctx.prefs.displayName.trim() ? ctx.prefs.displayName.trim() : meta.title
  const preview = id === 'match-preview' ? previewMatch(ctx) : null
  return (
    <section className={`widget ${meta.scrolls ? 'scrolls' : ''}`} style={{ '--grow': meta.grow } as CSSProperties} aria-labelledby={headingId} data-widget={id}>
      <div className="widget-head">
        <h2 id={headingId}>{title}</h2>
        {preview ? (
          <span className="hint">
            {preview.label}
            {ctx.team != null && allianceOf(preview, ctx.team) ? ` · you are ${allianceOf(preview, ctx.team)}` : ''}
          </span>
        ) : null}
        {autoScroll && ctx.prefs.autoScroll ? (
          <button type="button" className="btn ghost small" aria-pressed={paused} onClick={() => setPaused(p => !p)}>
            {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
            {paused ? 'Resume scrolling' : 'Pause scrolling'}
          </button>
        ) : null}
      </div>
      <AutoScroll enabled={autoScroll && ctx.prefs.autoScroll && !paused} reduced={ctx.reducedMotion} focusable={!!meta.scrolls} labelledBy={headingId}>
        {meta.needsTeam && ctx.team == null ? <NeedsTeam /> : <WidgetContent id={id} ctx={ctx} />}
      </AutoScroll>
    </section>
  )
}

function WidgetContent({ id, ctx }: { id: WidgetId; ctx: DisplayCtx }) {
  switch (id) {
    case 'next-match': return <NextMatch ctx={ctx} />
    case 'team-status': return <TeamStatus ctx={ctx} />
    case 'match-preview': return <MatchPreview ctx={ctx} />
    case 'our-schedule': return <OurSchedule ctx={ctx} />
    case 'last-result': return <LastResult ctx={ctx} />
    case 'rankings': return <Rankings ctx={ctx} />
    case 'upcoming': return <Upcoming ctx={ctx} />
    case 'alliances': return <Alliances ctx={ctx} />
    case 'checklist': return <Checklist ctx={ctx} />
    case 'message': return <Message ctx={ctx} />
  }
}

/**
 * Slowly scrolls overflowing content so a wall-mounted screen shows all of it.
 * Stops while the pointer or keyboard focus is inside. With reduced motion it
 * pages instead of gliding.
 */
function AutoScroll({ enabled, reduced, focusable, labelledBy, children }: {
  enabled: boolean
  reduced: boolean
  /** Long lists can be scrolled with the keyboard. */
  focusable: boolean
  labelledBy: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const hold = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0
    let pos = el.scrollTop
    let waitUntil = performance.now() + 4000
    const SPEED = 24 // px per second
    const step = (t: number) => {
      frame = requestAnimationFrame(step)
      const dt = last ? t - last : 0
      last = t
      if (hold.current || t < waitUntil) return
      const max = el.scrollHeight - el.clientHeight
      if (max <= 2) return
      if (pos >= max - 1) {
        pos = 0
        el.scrollTop = 0
        waitUntil = t + 5000
        return
      }
      pos = Math.min(max, pos + (SPEED * dt) / 1000)
      el.scrollTop = pos
      if (pos >= max - 1) waitUntil = t + 4000
    }
    const page = () => {
      timer = setTimeout(page, 12_000)
      if (hold.current) return
      const max = el.scrollHeight - el.clientHeight
      if (max <= 2) return
      el.scrollTop = el.scrollTop >= max - 1 ? 0 : Math.min(max, el.scrollTop + el.clientHeight * 0.9)
    }
    if (reduced) timer = setTimeout(page, 12_000)
    else frame = requestAnimationFrame(step)
    const sync = () => { pos = el.scrollTop }
    el.addEventListener('scroll', sync, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      el.removeEventListener('scroll', sync)
    }
  }, [enabled, reduced])
  return (
    <div
      ref={ref}
      className="widget-body"
      tabIndex={focusable ? 0 : undefined}
      role={focusable ? 'group' : undefined}
      aria-labelledby={focusable ? labelledBy : undefined}
      onPointerEnter={() => { hold.current = true }}
      onPointerLeave={() => { hold.current = false }}
      onFocus={() => { hold.current = true }}
      onBlur={() => { hold.current = false }}
    >
      {children}
    </div>
  )
}

// ── Next match ───────────────────────────────────────────────────────────────

function NextMatch({ ctx }: { ctx: DisplayCtx }) {
  const team = ctx.team!
  const q = ctx.queue
  const clock = (t: number | null) => formatClock(t, ctx.timeZone, ctx.prefs.clock)
  if (!ctx.snapshot.matches.length) {
    return <Empty title="Schedule not posted yet"><span>Your matches show up here as soon as the event publishes its schedule.</span></Empty>
  }
  if (!q?.match) {
    const r = record(ctx.snapshot.matches, team)
    return ctx.ours.length ? (
      <Empty title="No more scheduled matches">
        <span>Qualification record {r.wins}-{r.losses}-{r.ties}. Playoff matches appear here once alliances are set.</span>
      </Empty>
    ) : (
      <Empty title={`No matches for team ${team}`}><span>Check the team number in Settings.</span></Empty>
    )
  }
  const m = q.match
  const s = sides(m, team)
  const est = q.estimatedStart
  let main: string
  let sub: string
  let icon = <ClockIcon className="q-icon" />
  switch (q.kind) {
    case 'on-field':
      main = 'On the field now'
      sub = 'Good luck!'
      icon = <FieldIcon className="q-icon" />
      break
    case 'now':
      main = 'Queue now'
      sub = est != null ? `${m.label} starts ${formatRelative(est, ctx.now)}, about ${clock(est)}` : `${m.label} is coming up`
      icon = <BellIcon className="q-icon" />
      break
    case 'soon':
      main = `Queue in ${formatDuration(Math.max(0, (q.queueAt ?? ctx.now) - ctx.now))}`
      sub = `At ${clock(q.queueAt)} · match about ${clock(est)}`
      icon = <BellIcon className="q-icon" />
      break
    default:
      main = q.matchesAway === 1 ? '1 match away' : `${q.matchesAway ?? '?'} matches away`
      sub = est != null ? `Starts about ${clock(est)} (${formatRelative(est, ctx.now)})` : 'Start time not scheduled'
  }
  const delayed = m.scheduled != null && est != null && Math.abs(est - m.scheduled) >= 60_000
  return (
    <div>
      <div className="nm-top">
        <div>
          <div className="nm-title">{m.longLabel}</div>
          {m.field && (ctx.snapshot.event?.fieldCount ?? 1) > 1 ? <div className="nm-sub">Field {m.field}</div> : null}
        </div>
        {s.alliance ? <AllianceTag alliance={s.alliance} long /> : null}
      </div>
      <div className={`queue ${q.kind}`}>
        {icon}
        <div className="q-text">
          <span className="q-main">{main}</span>
          <span className="q-sub">{sub}</span>
        </div>
      </div>
      <div className="nm-grid">
        <div>
          <h3>With</h3>
          <ul className="chip-list">
            {s.partners.length
              ? s.partners.map(t => <TeamChip key={t.team} ctx={ctx} team={t.team} alliance={s.alliance!} flags={chipFlags(t)} />)
              : <li className="muted">No partner</li>}
          </ul>
        </div>
        <div>
          <h3>Against</h3>
          <ul className="chip-list">
            {s.opponents.map(t => <TeamChip key={t.team} ctx={ctx} team={t.team} alliance={t.alliance} flags={chipFlags(t)} />)}
          </ul>
        </div>
      </div>
      <div className="nm-times">
        <span>Scheduled <strong>{clock(m.scheduled)}</strong></span>
        {delayed ? <span>Estimated <strong>{clock(est)}</strong></span> : null}
      </div>
    </div>
  )
}

function chipFlags(t: Match['teams'][number]): string[] {
  const f: string[] = []
  if (!t.onField) f.push('Sits out')
  if (t.surrogate) f.push('Surrogate')
  return f
}

// ── Standing ─────────────────────────────────────────────────────────────────

function TeamStatus({ ctx }: { ctx: DisplayCtx }) {
  const team = ctx.team!
  const { rankings, stats, seasonStats, provenance } = ctx.snapshot
  const row = rankings.find(r => r.team === team)
  const rec = row?.wins != null ? { wins: row.wins, losses: row.losses ?? 0, ties: row.ties ?? 0 } : record(ctx.snapshot.matches, team)
  const played = row?.played ?? ctx.ours.filter(m => m.played && m.level === 'qual').length
  const ev = stats[team]
  const opr = ev?.source === 'event' ? (ctx.prefs.opr === 'np' ? ev.npOpr : ev.opr) : null
  const oprRank = ctx.oprRanks.get(team)
  const season = seasonStats[team]
  return (
    <div>
      <div className="big-rank">
        {row ? (
          <>
            <span className="r">{ordinal(row.rank)}</span>
            <span className="of">of {rankings.length} teams</span>
          </>
        ) : (
          <span className="r" style={{ fontSize: '2rem' }}>Not ranked yet</span>
        )}
      </div>
      <div className="stat-grid">
        <div className="stat">
          <span className="l">Ranking score</span>
          <span className="v">{fmt(row?.rankingScore, 2)}</span>
        </div>
        <div className="stat">
          <span className="l">Record</span>
          <span className="v">{rec.wins}-{rec.losses}-{rec.ties}</span>
          <span className="r"><span className="sr-only">wins, losses, ties; </span>{played} played</span>
        </div>
        <div className="stat">
          <span className="l">Event OPR</span>
          <span className="v">{fmt(opr)}</span>
          <span className="r">{oprRank ? `${ordinal(oprRank)} at event` : 'After first match'}{ctx.prefs.opr === 'np' ? ' · no penalties' : ''}</span>
        </div>
        <div className="stat">
          <span className="l">Season OPR</span>
          <span className="v">{fmt(season?.total.value)}</span>
          <span className="r">{season?.total.rank ? `#${season.total.rank}${season.count ? ` of ${season.count}` : ''} in the world` : 'No season data'}</span>
        </div>
      </div>
      <p className="hint" style={{ marginTop: '0.75rem' }}>
        {provenance.rankings === 'ftcEvents' ? 'Official rankings from FTC Events.' : provenance.rankings === 'ftcscout' ? 'Rankings from FTCScout.' : 'Rankings appear after the first matches.'}
      </p>
    </div>
  )
}

// ── Match preview ────────────────────────────────────────────────────────────

/** Your next match, or the next match on the field when no team is set. */
function previewMatch(ctx: DisplayCtx): Match | null {
  return ctx.team != null ? ctx.queue?.match ?? null : ctx.onField
}

function MatchPreview({ ctx }: { ctx: DisplayCtx }) {
  const m = previewMatch(ctx)
  if (!m) return <Empty title="Nothing to preview"><span>{ctx.team != null ? 'Your next match will show here.' : 'The next match on the field will show here.'}</span></Empty>
  const p = predict(m, ctx.snapshot.stats, ctx.snapshot.seasonStats, ctx.prefs.opr)
  const redPct = p.redWin != null ? Math.round(p.redWin * 100) : null
  const rows = (alliance: 'red' | 'blue') => m.teams.filter(t => t.alliance === alliance && t.onField)
  const s = (n: number) => ctx.snapshot.stats[n]
  return (
    <div>
      <div className="versus">
        <div className="side red">
          <AllianceTag alliance="red" />
          <span className="score num">{fmt(p.red, 0)}</span>
          <span className="sr-only">predicted points</span>
        </div>
        <span className="vs" aria-hidden>vs</span>
        <div className="side blue">
          <span style={{ alignSelf: 'flex-end' }}><AllianceTag alliance="blue" /></span>
          <span className="score num">{fmt(p.blue, 0)}</span>
          <span className="sr-only">predicted points</span>
        </div>
      </div>
      {redPct != null ? (
        <>
          <div className="winbar" role="img" aria-label={`Win chance: red ${redPct} percent, blue ${100 - redPct} percent`}>
            <span className="red" style={{ width: `${redPct}%` }} />
            <span className="blue" style={{ width: `${100 - redPct}%` }} />
          </div>
          <div className="winbar-labels" aria-hidden>
            <span className="side-red">Red {redPct}%</span>
            <span className="side-blue">Blue {100 - redPct}%</span>
          </div>
        </>
      ) : null}
      <table className="table breakdown">
        <caption className="sr-only">OPR of each team in {m.longLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="r">OPR</th>
            <th scope="col" className="r opt">Auto</th>
            <th scope="col" className="r opt">Teleop</th>
          </tr>
        </thead>
        <tbody>
          {(['red', 'blue'] as const).flatMap(a => rows(a).map(t => (
            <tr key={t.team} className={t.team === ctx.team ? 'me' : ctx.watch.has(t.team) ? 'watch' : ''}>
              <td>
                <span className={a === 'red' ? 'side-red' : 'side-blue'}>{a === 'red' ? 'R' : 'B'}</span>{' '}
                <span className="tn">{t.team}</span> <span className="tname">{teamName(ctx, t.team) ?? ''}</span>
                <span className="sr-only">, {a} alliance</span>
              </td>
              <td className="r">{fmt(oprOf(ctx, t.team))}</td>
              <td className="r opt">{fmt(s(t.team)?.autoOpr)}</td>
              <td className="r opt">{fmt(s(t.team)?.teleopOpr)}</td>
            </tr>
          )))}
        </tbody>
      </table>
      <p className="hint preview-note" style={{ marginTop: '0.5rem' }}>
        Estimate from {ctx.prefs.opr === 'np' ? 'no-penalty ' : ''}OPR{p.missing.length ? `; no data yet for ${p.missing.join(', ')}` : ''}.
      </p>
    </div>
  )
}

// ── Our matches ──────────────────────────────────────────────────────────────

function OurSchedule({ ctx }: { ctx: DisplayCtx }) {
  const team = ctx.team!
  if (!ctx.ours.length) return <Empty title="No matches yet"><span>Your matches appear once the schedule is published.</span></Empty>
  const next = ctx.queue?.match?.key
  return (
    <table className="table">
      <caption className="sr-only">Matches for team {team}</caption>
      <thead>
        <tr>
          <th scope="col">Match</th>
          <th scope="col">Time</th>
          <th scope="col">Alliance &amp; partner</th>
          <th scope="col">Against</th>
          <th scope="col" className="r">Result</th>
        </tr>
      </thead>
      <tbody>
        {ctx.ours.map(m => {
          const s = sides(m, team)
          const res = resultFor(m, team)
          const mine = s.alliance === 'red' ? m.red : m.blue
          const theirs = s.alliance === 'red' ? m.blue : m.red
          const est = ctx.timing.estimates.get(m.key)
          const t = m.played ? m.actual ?? m.scheduled : ctx.prefs.adjustForDelay ? est ?? m.scheduled : m.scheduled
          return (
            <tr key={m.key} className={m.key === next ? 'next' : ''} aria-current={m.key === next ? 'true' : undefined}>
              <td><strong>{m.label}</strong>{m.key === next ? <span className="sr-only"> (next)</span> : null}</td>
              <td className="num">{!m.played && est != null && ctx.prefs.adjustForDelay ? '~' : ''}{formatClock(t, ctx.timeZone, ctx.prefs.clock)}</td>
              <td>
                <span className="alliance-cell">
                  {s.alliance ? <AllianceTag alliance={s.alliance} /> : null}
                  <span className="sr-only">with</span>
                  <TeamsInline ctx={ctx} teams={s.partners.map(p => p.team)} />
                </span>
              </td>
              <td><TeamsInline ctx={ctx} teams={s.opponents.map(p => p.team)} /></td>
              <td className="r">
                {res && mine && theirs ? <ResultBadge result={res} score={`${mine.total}–${theirs.total}`} /> : m.key === next ? <span className="badge soon">Next</span> : <span className="muted">–</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Last result ──────────────────────────────────────────────────────────────

function LastResult({ ctx }: { ctx: DisplayCtx }) {
  const team = ctx.team!
  const m = [...ctx.ours].reverse().find(x => x.played && x.red && x.blue)
  if (!m || !m.red || !m.blue) return <Empty title="No results yet"><span>The score breakdown of your latest match shows here.</span></Empty>
  const res = resultFor(m, team)
  const s = sides(m, team)
  const rows: [string, (a: NonNullable<Match['red']>) => number | null][] = [
    ['Auto', a => a.auto],
    ['Teleop', a => a.teleop],
    ['Penalty points received', a => a.penalty],
    ['Total', a => a.total],
  ]
  return (
    <div>
      <div className="nm-top">
        <div>
          <div className="nm-title" style={{ fontSize: 'clamp(1.4rem, 2vw, 2.25rem)' }}>{m.longLabel}</div>
          <div className="nm-sub">You were {s.alliance}{s.partners.length ? ` with ${s.partners.map(p => p.team).join(', ')}` : ''}</div>
        </div>
        {res ? <ResultBadge result={res} /> : null}
      </div>
      <table className="table breakdown">
        <caption className="sr-only">Score breakdown for {m.longLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Points</th>
            <th scope="col" className="r"><span className="side-red">Red</span></th>
            <th scope="col" className="r"><span className="side-blue">Blue</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} className={label === 'Total' ? 'total' : ''}>
              <th scope="row">{label}</th>
              <td className="r">{fmt(get(m.red!), 0)}</td>
              <td className="r">{fmt(get(m.blue!), 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Rankings ─────────────────────────────────────────────────────────────────

function Rankings({ ctx }: { ctx: DisplayCtx }) {
  const { rankings } = ctx.snapshot
  if (!rankings.length) return <Empty title="No rankings yet"><span>Rankings appear after the first qualification matches.</span></Empty>
  return (
    <table className="table">
      <caption className="sr-only">Event rankings</caption>
      <thead>
        <tr>
          <th scope="col" className="r">#</th>
          <th scope="col">Team</th>
          <th scope="col" className="r">RS</th>
          <th scope="col" className="r">W-L-T</th>
          <th scope="col" className="r">OPR</th>
        </tr>
      </thead>
      <tbody>
        {rankings.map(r => {
          const me = r.team === ctx.team
          const watch = !me && ctx.watch.has(r.team)
          return (
            <tr key={r.team} className={me ? 'me' : watch ? 'watch' : ''} aria-current={me ? 'true' : undefined}>
              <td className="r">{r.rank}</td>
              <td>
                <span className={`tn ${watch ? 'is-watch' : ''}`}>{r.team}</span>{' '}
                <span className="tname">{teamName(ctx, r.team) ?? ''}</span>
                {me ? <span className="sr-only"> (your team)</span> : null}
              </td>
              <td className="r">{fmt(r.rankingScore, 2)}</td>
              <td className="r">{r.wins ?? '–'}-{r.losses ?? '–'}-{r.ties ?? '–'}</td>
              <td className="r">{fmt(oprOf(ctx, r.team))}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Upcoming on the field ────────────────────────────────────────────────────

function Upcoming({ ctx }: { ctx: DisplayCtx }) {
  // Only matches after the last played one, skipping unplayed leftovers.
  const lastPlayed = ctx.snapshot.matches.findLastIndex(x => x.played)
  const upcoming = ctx.snapshot.matches.filter((m, i) => i > lastPlayed && !m.played).slice(0, 12)
  if (!ctx.snapshot.matches.length) return <Empty title="Schedule not posted yet" />
  if (!upcoming.length) return <Empty title="No more scheduled matches" />
  return (
    <table className="table">
      <caption className="sr-only">Upcoming matches at the event</caption>
      <thead>
        <tr>
          <th scope="col">Match</th>
          <th scope="col">{ctx.prefs.adjustForDelay ? 'Est. start' : 'Scheduled'}</th>
          <th scope="col">Red</th>
          <th scope="col">Blue</th>
        </tr>
      </thead>
      <tbody>
        {upcoming.map((m, i) => {
          const teams = m.teams.map(t => t.team)
          const me = ctx.team != null && teams.includes(ctx.team)
          const watch = !me && teams.some(t => ctx.watch.has(t))
          const est = ctx.prefs.adjustForDelay ? ctx.timing.estimates.get(m.key) ?? m.scheduled : m.scheduled
          return (
            <tr key={m.key} className={me ? 'me' : watch ? 'watch' : ''}>
              <td>
                <strong>{m.label}</strong>
                {i === 0 ? <span className="badge live" style={{ marginLeft: '0.5rem' }}>Next up</span> : null}
              </td>
              <td className="num">{formatClock(est, ctx.timeZone, ctx.prefs.clock)}</td>
              <td><span className="sr-only">Red: </span><TeamsInline ctx={ctx} teams={m.teams.filter(t => t.alliance === 'red').map(t => t.team)} /></td>
              <td><span className="sr-only">Blue: </span><TeamsInline ctx={ctx} teams={m.teams.filter(t => t.alliance === 'blue').map(t => t.team)} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Alliances ────────────────────────────────────────────────────────────────

function Alliances({ ctx }: { ctx: DisplayCtx }) {
  const { alliances } = ctx.snapshot
  if (!alliances.length) return <Empty title="Alliance selection hasn’t happened yet"><span>Alliances appear here after selection.</span></Empty>
  return (
    <ul className="alliance-list">
      {alliances.map((a, i) => {
        const me = ctx.team != null && a.teams.includes(ctx.team)
        return (
          <li key={a.name + i} className={me ? 'me' : ''}>
            <span className="seed">{a.number != null ? `A${a.number}` : '–'}</span>
            <span className="sr-only">{a.name}: </span>
            <TeamsInline ctx={ctx} teams={a.teams} />
            {me ? <span className="sr-only"> (your alliance)</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

// ── Checklist ────────────────────────────────────────────────────────────────

function Checklist({ ctx }: { ctx: DisplayCtx }) {
  const items = ctx.prefs.checklist
  // Ticks are kept per match, so the list starts fresh for every match.
  const matchKey = ctx.queue?.match?.key ?? 'general'
  const storageKey = `pulsedash:check:${ctx.team ?? 'event'}:${ctx.snapshot.event?.code ?? ''}:${matchKey}`
  const [done, setDone] = useState<boolean[]>([])
  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
    } catch {
      setDone([])
    }
  }, [storageKey])
  const toggle = (i: number) => {
    const next = items.map((_, j) => (j === i ? !done[j] : !!done[j]))
    setDone(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
  }
  if (!items.length) return <Empty title="No checklist items"><span>Add items in Settings → Team.</span></Empty>
  const count = items.filter((_, i) => done[i]).length
  return (
    <div>
      <p className="progress-text" aria-live="polite">{count} of {items.length} done{ctx.queue?.match ? ` for ${ctx.queue.match.label}` : ''}</p>
      <ul className="checklist">
        {items.map((item, i) => (
          <li key={i}>
            <label>
              <input type="checkbox" checked={!!done[i]} onChange={() => toggle(i)} />
              <span>{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Message ──────────────────────────────────────────────────────────────────

function Message({ ctx }: { ctx: DisplayCtx }) {
  const message = ctx.prefs.message.trim()
  const { logo } = ctx.prefs
  if (!message && !logo) return <Empty title="Add a welcome message"><span>Settings → Team lets you add a message and logo for visitors.</span></Empty>
  return (
    <div className="message-card">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={`${ctx.prefs.displayName.trim() || (ctx.team != null ? teamName(ctx, ctx.team) : '') || 'Team'} logo`} />
      ) : null}
      {message ? <p>{message}</p> : null}
    </div>
  )
}
