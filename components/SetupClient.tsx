'use client'
// Pick a team (optional) and an event, then open the display. Mirrors the
// "select event" flow of other pit displays, with the team's own events
// offered first.
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useId, useMemo, useState } from 'react'
import { fetchEventList, fetchTeamEvents, type TeamLookup } from '@/lib/ftcscout'
import { currentSeason, dateInZone, formatDateRange, seasonLabel } from '@/lib/time'
import type { EventSummary } from '@/lib/types'

const FIRST_SEASON = 2019
const HIDDEN_TYPES = new Set(['Kickoff', 'Workshop', 'DemoExhibition', 'VolunteerSignup', 'PracticeDay', 'InnovationChallenge'])
const PAGE = 40

type Filter = 'now' | 'upcoming' | 'past' | 'all'
type Status = 'live' | 'upcoming' | 'past'

function statusOf(e: EventSummary, today: string): Status {
  if (e.start && e.start > today) return 'upcoming'
  if (e.end && e.end < today) return 'past'
  return 'live'
}

function typeLabel(type: string | null) {
  return type ? type.replace(/([a-z])([A-Z])/g, '$1 $2').replace('F I R S T', 'FIRST') : null
}

function readList(season: number): EventSummary[] | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(`pulsedash:events:${season}`) ?? 'null')
    return c && Date.now() - c.at < 10 * 60_000 ? c.list : null
  } catch {
    return null
  }
}

export default function SetupClient() {
  const params = useSearchParams()
  const ids = { team: useId(), season: useId(), search: useId(), list: useId() }
  const [season, setSeason] = useState(() => {
    const s = Number(params.get('season'))
    return s >= FIRST_SEASON && s <= currentSeason() ? s : currentSeason()
  })
  const [teamInput, setTeamInput] = useState(() => {
    const fromUrl = params.get('team')
    if (fromUrl && /^\d+$/.test(fromUrl)) return fromUrl
    try { return localStorage.getItem('pulsedash:lastTeam') ?? '' } catch { return '' }
  })
  const [lookup, setLookup] = useState<{ state: 'idle' | 'loading' | 'ok' | 'missing' | 'error'; data?: TeamLookup }>({ state: 'idle' })
  const [events, setEvents] = useState<{ state: 'loading' | 'ok' | 'error'; list: EventSummary[]; error?: string }>({ state: 'loading', list: [] })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter | null>(null)
  const [selected, setSelected] = useState(() => (params.get('event') ?? '').toUpperCase())
  const [limit, setLimit] = useState(PAGE)
  const [retry, setRetry] = useState(0)

  const today = dateInZone(Date.now())
  const team = /^\d{1,6}$/.test(teamInput) && Number(teamInput) > 0 ? Number(teamInput) : null

  useEffect(() => {
    const cached = readList(season)
    if (cached) {
      setEvents({ state: 'ok', list: cached })
      return
    }
    const controller = new AbortController()
    setEvents({ state: 'loading', list: [] })
    fetchEventList(season, controller.signal)
      .then(list => {
        try { sessionStorage.setItem(`pulsedash:events:${season}`, JSON.stringify({ at: Date.now(), list })) } catch { /* ignore */ }
        setEvents({ state: 'ok', list })
      })
      .catch(err => {
        if (!controller.signal.aborted) setEvents({ state: 'error', list: [], error: (err as Error).message })
      })
    return () => controller.abort()
  }, [season, retry])

  useEffect(() => {
    if (team == null) {
      setLookup({ state: 'idle' })
      return
    }
    const controller = new AbortController()
    setLookup({ state: 'loading' })
    const t = setTimeout(() => {
      fetchTeamEvents(team, season, controller.signal)
        .then(data => setLookup(data ? { state: 'ok', data } : { state: 'missing' }))
        .catch(() => { if (!controller.signal.aborted) setLookup({ state: 'error' }) })
    }, 350)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [team, season])

  const usable = useMemo(
    () => events.list.filter(e => !e.remote && !(e.type && HIDDEN_TYPES.has(e.type))),
    [events.list],
  )
  const counts = useMemo(() => {
    const c = { live: 0, upcoming: 0, past: 0 }
    for (const e of usable) c[statusOf(e, today)]++
    return c
  }, [usable, today])
  const activeFilter: Filter = filter ?? (counts.live ? 'now' : 'upcoming')

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const rank = { live: 0, upcoming: 1, past: 2 }
    return usable
      .filter(e => {
        const s = statusOf(e, today)
        if (activeFilter === 'now' && s !== 'live') return false
        if (activeFilter === 'upcoming' && s !== 'upcoming') return false
        if (activeFilter === 'past' && s !== 'past') return false
        const hay = `${e.name} ${e.code} ${e.city ?? ''} ${e.state ?? ''} ${e.country ?? ''}`.toLowerCase()
        return words.every(w => hay.includes(w))
      })
      .sort((a, b) => {
        const sa = statusOf(a, today)
        const sb = statusOf(b, today)
        if (sa !== sb) return rank[sa] - rank[sb]
        const d = (a.start ?? '').localeCompare(b.start ?? '')
        return sa === 'past' ? -d : d
      })
  }, [usable, query, activeFilter, today])

  useEffect(() => setLimit(PAGE), [query, activeFilter, season])

  const teamEvents = lookup.state === 'ok' ? lookup.data!.events.filter(e => !e.remote) : []
  const selectedEvent = usable.find(e => e.code === selected) ?? teamEvents.find(e => e.code === selected) ?? null
  const href = selected ? `/view/?season=${season}&event=${encodeURIComponent(selected)}${team != null ? `&team=${team}` : ''}` : null

  const option = (e: EventSummary, group: string) => {
    const s = statusOf(e, today)
    const id = `${group}-${e.code}`
    return (
      <li key={id} className="event-option">
        <input type="radio" id={id} name="event" value={e.code} checked={selected === e.code} onChange={() => setSelected(e.code)} />
        <label htmlFor={id}>
          <span className="name">{e.name}</span>
          <span className="meta">
            {formatDateRange(e.start, e.end)}
            {[e.city, e.state, e.country].filter(Boolean).length ? ` · ${[e.city, e.state, e.country].filter(Boolean).join(', ')}` : ''}
            {typeLabel(e.type) ? ` · ${typeLabel(e.type)}` : ''}
          </span>
          <span className="side">
            {s === 'live' ? <span className="badge live">Happening now</span> : s === 'upcoming' ? <span className="badge soon">Upcoming</span> : <span className="badge">Finished</span>}
            <span className="code">{e.code}</span>
          </span>
        </label>
      </li>
    )
  }

  return (
    <main className="setup-main" id="setup">
      <header>
        <h2>Set up your pit display</h2>
        <p>Three steps. Your team’s layout and colors are saved on this device and can be shared by link.</p>
      </header>

      <section className="step" aria-labelledby="step-team">
        <div className="step-head">
          <span className="step-num" aria-hidden>1</span>
          <div>
            <h3 id="step-team">Your team</h3>
            <p>Optional. With a team number the display shows your next match, when to queue and how you’re doing.</p>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor={ids.team}>Team number</label>
            <input id={ids.team} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="e.g. 16236"
              value={teamInput} onChange={e => setTeamInput(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-describedby={`${ids.team}-status`} />
          </div>
          <div className="field" style={{ flex: '0 1 10rem' }}>
            <label htmlFor={ids.season}>Season</label>
            <select id={ids.season} value={season} onChange={e => { setSeason(Number(e.target.value)); setSelected('') }}>
              {Array.from({ length: currentSeason() - FIRST_SEASON + 1 }, (_, i) => currentSeason() - i).map(s => (
                <option key={s} value={s}>{seasonLabel(s)}</option>
              ))}
            </select>
          </div>
        </div>
        <div id={`${ids.team}-status`} role="status">
          {lookup.state === 'loading' ? <p className="hint">Looking up team {team}…</p> : null}
          {lookup.state === 'ok' ? (
            <div className="team-found">
              <strong>{lookup.data!.number} {lookup.data!.name}</strong>
              {lookup.data!.place ? <span>· {lookup.data!.place}</span> : null}
            </div>
          ) : null}
          {lookup.state === 'missing' ? <p className="notice">No team {team} on FTCScout. Check the number, or carry on without one.</p> : null}
          {lookup.state === 'error' ? <p className="notice">Couldn’t look up team {team} right now. You can still pick an event.</p> : null}
        </div>
        {teamEvents.length ? (
          <fieldset>
            <legend>Team {team}’s events in {seasonLabel(season)}</legend>
            <ul className="event-list">{teamEvents.map(e => option(e, 'team'))}</ul>
          </fieldset>
        ) : lookup.state === 'ok' ? <p className="hint">Team {team} isn’t registered for any {seasonLabel(season)} events on FTCScout yet. Search all events below.</p> : null}
      </section>

      <section className="step" aria-labelledby="step-event">
        <div className="step-head">
          <span className="step-num" aria-hidden>2</span>
          <div>
            <h3 id="step-event">Event</h3>
            <p>Search by event name, code or city.</p>
          </div>
        </div>
        <div className="filters">
          <div className="field">
            <label htmlFor={ids.search}>Search events</label>
            <input id={ids.search} type="search" placeholder="e.g. Houston, USTXHOQ1" value={query} onChange={e => setQuery(e.target.value)} aria-controls={ids.list} />
          </div>
          <fieldset style={{ flex: '2 1 22rem' }}>
            <legend>Show</legend>
            <div className="seg">
              {([['now', `Happening now (${counts.live})`], ['upcoming', `Upcoming (${counts.upcoming})`], ['past', `Finished (${counts.past})`], ['all', 'All']] as const).map(([v, label]) => (
                <label key={v}>
                  <input type="radio" name="filter" value={v} checked={activeFilter === v} onChange={() => setFilter(v)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {events.state === 'loading' ? <p className="hint" role="status">Loading {seasonLabel(season)} events from FTCScout…</p> : null}
        {events.state === 'error' ? (
          <div className="notice error" role="alert">
            <p style={{ margin: '0 0 0.5rem' }}>Couldn’t load events from FTCScout. {events.error}</p>
            <button type="button" className="btn outline small" onClick={() => setRetry(r => r + 1)}>Try again</button>
          </div>
        ) : null}
        {events.state === 'ok' ? (
          <fieldset>
            <legend className="sr-only">Events</legend>
            <p className="sr-only" role="status">{results.length} events match.</p>
            <ul className="event-list" id={ids.list}>
              {results.slice(0, limit).map(e => option(e, 'all'))}
            </ul>
            <div className="list-foot">
              <span>Showing {Math.min(limit, results.length)} of {results.length}</span>
              {results.length > limit ? <button type="button" className="btn outline small" onClick={() => setLimit(l => l + PAGE)}>Show more</button> : null}
            </div>
            {!results.length ? <p className="hint">No events match. Try another filter or season.</p> : null}
          </fieldset>
        ) : null}
      </section>

      <section className="step" aria-labelledby="step-open">
        <div className="step-head">
          <span className="step-num" aria-hidden>3</span>
          <div>
            <h3 id="step-open">Open the display</h3>
            <p>Customize it from the ⚙ Settings button: layout, team color, logo, text size, high contrast, checklist and more.</p>
          </div>
        </div>
      </section>

      <div className="launch" role="region" aria-label="Open display">
        <div className="summary">
          <strong>{selectedEvent?.name ?? (selected || 'No event selected')}</strong>
          <span>{team != null ? `Team ${team}` : 'No team: whole-event view'} · {seasonLabel(season)}</span>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <Link className="btn outline" href="/view/?demo=1">Try the demo</Link>
          {href ? (
            <Link className="btn primary" href={href}>Open display</Link>
          ) : (
            <button type="button" className="btn primary" aria-disabled="true" onClick={() => document.getElementById(ids.search)?.focus()}>
              Pick an event first
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
