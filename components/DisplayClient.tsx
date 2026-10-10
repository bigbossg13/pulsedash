'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePitData } from '@/lib/usePitData'
import { DEMO_CODE, DEMO_TEAM } from '@/lib/demo'
import { estimateTiming, nextOnField, oprRanks, ordinal, queueStatus, resultFor, teamMatches } from '@/lib/derive'
import { BRAND_ORANGE, decodePrefs, loadPrefs, readableInk, savePrefs, type PitPrefs } from '@/lib/settings'
import { currentSeason, formatClock, formatDuration, seasonLabel } from '@/lib/time'
import type { EventSnapshot, SourceStatus } from '@/lib/types'
import type { Timing } from '@/lib/derive'
import { ExpandIcon, PulseLogo, RefreshIcon, SettingsIcon, ShrinkIcon } from './icons'
import { Widget } from './widgets'
import SettingsDialog from './SettingsDialog'
import type { DisplayCtx } from './ui'

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function useMedia(query: string) {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(query)
    setMatch(m.matches)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

const parseTeam = (v: string | null) => (v && /^\d{1,6}$/.test(v) && Number(v) > 0 ? Number(v) : null)
const parseCode = (v: string | null) => (v ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24)

/** Reads the URL and remounts the display whenever the season, event or team changes. */
export default function DisplayRoute() {
  const params = useSearchParams()
  const demo = params.get('demo') != null
  const season = demo ? currentSeason() : Number(params.get('season')) || currentSeason()
  const code = demo ? DEMO_CODE : parseCode(params.get('event'))
  const team = demo ? DEMO_TEAM : parseTeam(params.get('team'))
  if (!code) {
    return (
      <main className="setup-main" style={{ margin: '0 auto' }}>
        <h1>No event selected</h1>
        <p>Pick your event and team first.</p>
        <p><Link className="btn primary" href="/">Choose an event</Link></p>
      </main>
    )
  }
  return <Display key={`${season}-${code}-${team}`} season={season} code={code} team={team} demo={demo} />
}

function Display({ season, code, team, demo }: { season: number; code: string; team: number | null; demo: boolean }) {
  const router = useRouter()
  const [prefs, setPrefsState] = useState<PitPrefs>(() => loadPrefs(team))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const updatePrefs = useCallback((p: PitPrefs) => {
    setPrefsState(p)
    savePrefs(team, p)
  }, [team])

  // A share link carries settings in the hash: apply them, save them for this team, tidy the URL.
  useEffect(() => {
    try { if (team != null && !demo) localStorage.setItem('pulsedash:lastTeam', String(team)) } catch { /* ignore */ }
    const m = /[#&]prefs=([A-Za-z0-9_-]+)/.exec(window.location.hash)
    if (!m) return
    const shared = decodePrefs(m[1], team)
    if (shared) {
      updatePrefs({ ...shared, logo: shared.logo || prefs.logo })
      setNotice('Settings from the shared link were applied and saved on this device.')
    }
    history.replaceState(null, '', window.location.pathname + window.location.search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme, text size, font, motion and team color live on <html> so dialogs and scrollbars match.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.page = 'display'
    const attr = (name: string, value: string | null) => (value ? root.setAttribute(name, value) : root.removeAttribute(name))
    attr('data-theme', prefs.theme === 'auto' ? null : prefs.theme)
    attr('data-text', prefs.textSize === 'm' ? null : prefs.textSize)
    attr('data-font', prefs.font === 'readable' ? 'readable' : null)
    attr('data-motion', prefs.motion === 'reduce' ? 'reduce' : null)
    const accent = prefs.accent || BRAND_ORANGE
    root.style.setProperty('--team', accent)
    root.style.setProperty('--team-ink', readableInk(accent))
  }, [prefs.theme, prefs.textSize, prefs.font, prefs.motion, prefs.accent])

  const { snapshot, refreshNow, restoredAt, hasData } = usePitData({ season, code, refresh: prefs.refresh, proxy: prefs.proxy, demo })
  const now = useNow(1000)
  const systemReduced = useMedia('(prefers-reduced-motion: reduce)')
  const reducedMotion = systemReduced || prefs.motion === 'reduce'

  // Timing estimates only need to move every few seconds.
  const coarseNow = Math.floor(now / 5000) * 5000
  const timing = useMemo(() => estimateTiming(snapshot.matches, coarseNow), [snapshot.matches, coarseNow])
  const ours = useMemo(() => (team != null ? teamMatches(snapshot.matches, team) : []), [snapshot.matches, team])
  const ranks = useMemo(() => oprRanks(snapshot.stats, prefs.opr), [snapshot.stats, prefs.opr])
  const queue = team != null
    ? queueStatus(snapshot.matches, team, timing, now, { leadMinutes: prefs.queueMinutes, leadMatches: prefs.queueMatches, adjustForDelay: prefs.adjustForDelay })
    : null
  const onField = useMemo(() => nextOnField(snapshot.matches), [snapshot.matches])
  const timeZone = snapshot.event?.timezone ?? null
  const watch = useMemo(() => new Set(prefs.watch), [prefs.watch])

  const ctx: DisplayCtx = { snapshot, team, prefs, now, timing, queue, ours, onField, timeZone, oprRanks: ranks, watch, reducedMotion }

  const announcement = useAnnouncements(snapshot, team, queue?.kind ?? null, queue?.match?.longLabel ?? null, hasData)
  useWakeLock(prefs.keepAwake)
  const fullscreen = useFullscreen()
  const cursorHidden = useIdleCursor(prefs.hideCursor && !settingsOpen)

  const teamInfo = team != null ? snapshot.teams[team] : null
  const title = prefs.displayName.trim() || teamInfo?.name || (team != null ? `Team ${team}` : snapshot.event?.name ?? code)
  const eventName = snapshot.event?.name ?? code
  const place = [snapshot.event?.venue, snapshot.event?.city, snapshot.event?.state].filter(Boolean).join(', ')
  const field = fieldStatus(snapshot, timing, now, timeZone, prefs)
  const columns = prefs.columns.length
  const gridTemplateColumns = columns === 3 ? '1.15fr 1fr 1fr' : columns === 2 ? '1.1fr 1fr' : '1fr'

  useEffect(() => {
    document.title = `${team != null ? `${team} · ` : ''}${eventName} · PulseDash`
  }, [team, eventName])

  const switchTeam = (t: number | null) => {
    if (t === team) return
    const q = new URLSearchParams({ season: String(season), event: code })
    if (t != null) q.set('team', String(t))
    setSettingsOpen(false)
    router.replace(`/view/?${q}`)
  }
  const changeEventHref = `/?season=${season}${team != null && !demo ? `&team=${team}` : ''}`

  const stale = staleness(snapshot.sources, restoredAt, now)

  return (
    <div className={`display ${cursorHidden ? 'cursor-hidden' : ''}`}>
      <a className="skip-link" href="#dashboard">Skip to the dashboard</a>
      <header className="d-header">
        <Link className="d-brand" href={changeEventHref} aria-label="PulseDash: change event or team">
          <PulseLogo size={30} />
          <span>PulseDash</span>
        </Link>
        <div className="d-team">
          {prefs.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={prefs.logo} alt="" />
          ) : null}
          {team != null ? <span className="num-big" aria-hidden>{team}</span> : null}
          <div className="who">
            <strong>{team != null ? title : eventName}</strong>
            <span>{team != null ? eventName : place || seasonLabel(season)}{team != null && place ? ` · ${place}` : ''}{demo ? ' · Demo data' : ''}</span>
          </div>
        </div>
        <div className="d-field" role="group" aria-label="Field status">
          <span className="k">{field.k}</span>
          <span className="v">{field.v}</span>
          {field.s ? <span className="s">{field.s}</span> : null}
        </div>
        <time className="d-clock" dateTime={new Date(now).toISOString()} aria-label={`Time at the event: ${formatClock(now, timeZone, prefs.clock)}`}>
          {formatClock(now, timeZone, prefs.clock)}
        </time>
        <div className="d-actions">
          <button type="button" className="icon-btn optional" onClick={refreshNow} aria-label="Refresh now" title="Refresh now"><RefreshIcon /></button>
          <button type="button" className="icon-btn optional" onClick={fullscreen.toggle} aria-pressed={fullscreen.active} aria-label="Full screen" title="Full screen">
            {fullscreen.active ? <ShrinkIcon /> : <ExpandIcon />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" aria-label="Settings" title="Settings"><SettingsIcon /></button>
        </div>
      </header>

      {stale || notice ? (
        <div className="banner" role="status">
          <span>{stale ?? notice}</span>
          {notice && !stale ? <button type="button" className="btn ghost small" onClick={() => setNotice('')}>Dismiss</button> : null}
        </div>
      ) : null}

      <main id="dashboard" className="d-main" tabIndex={-1}>
        <h1 className="sr-only">{team != null ? `Pit display for team ${team}, ${title}, at ${eventName}` : `Pit display for ${eventName}`}</h1>
        {!hasData ? (
          <LoadingOrError sources={snapshot.sources} code={code} season={season} changeEventHref={changeEventHref} />
        ) : (
          <div className="d-columns" style={{ gridTemplateColumns } as CSSProperties}>
            {prefs.columns.map((col, i) => (
              <div className="d-col" key={i}>
                {col.map(id => <Widget key={id} id={id} ctx={ctx} />)}
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="d-footer">
        <div className="sources" aria-label="Data sources">
          <SourceLabel name="FTCScout" status={snapshot.sources.ftcscout} now={now} />
          <SourceLabel name="FTC Events" status={snapshot.sources.ftcEvents} now={now} />
          {snapshot.provenance.matches ? <span>Schedule from {snapshot.provenance.matches === 'ftcEvents' ? 'FTC Events' : 'FTCScout'}</span> : null}
        </div>
        <span>{code} · {seasonLabel(season)} season</span>
      </footer>

      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        onChange={updatePrefs}
        team={team}
        season={season}
        eventCode={code}
        demo={demo}
        ftcEvents={snapshot.sources.ftcEvents}
        onSwitchTeam={switchTeam}
        changeEventHref={changeEventHref}
      />
    </div>
  )
}

function SourceLabel({ name, status, now }: { name: string; status: SourceStatus; now: number }) {
  const text =
    status.state === 'off' ? 'not connected'
    : status.state === 'loading' ? 'connecting…'
    : status.state === 'error' ? (status.at ? `problem, last update ${formatDuration(now - status.at)} ago` : 'unreachable')
    : status.at ? `updated ${formatDuration(now - status.at)} ago` : 'ok'
  return <span className={`src ${status.state}`} title={status.message}>{name}: {text}</span>
}

function fieldStatus(snapshot: EventSnapshot, timing: Timing, now: number, tz: string | null, prefs: PitPrefs) {
  const ms = snapshot.matches
  if (!ms.length) return { k: 'Field', v: 'No schedule yet', s: '' }
  const next = nextOnField(ms)
  if (!next) return { k: 'Field', v: 'All matches played', s: '' }
  const started = ms.some(m => m.played)
  if (!started && next.scheduled != null && next.scheduled > now) {
    return { k: 'First match', v: next.label, s: `Starts ${formatClock(next.scheduled, tz, prefs.clock)}` }
  }
  const d = timing.delay
  const s = d == null ? '' : Math.abs(d) < 2 * 60_000 ? 'On schedule' : d > 0 ? `${formatDuration(d)} behind` : `${formatDuration(d)} ahead`
  return { k: 'Up next on field', v: next.label, s }
}

const ago = (t: number, now: number) => (now - t < 60_000 ? 'less than a minute ago' : `${formatDuration(now - t)} ago`)

function staleness(sources: Record<string, SourceStatus>, restoredAt: number | null, now: number): string | null {
  const live = Object.values(sources).filter(s => s.state !== 'off')
  if (!live.length || !live.every(s => s.state === 'error')) return null
  const last = Math.max(restoredAt ?? 0, ...live.map(s => s.at ?? 0))
  return last ? `Offline: showing data from ${ago(last, now)}. Retrying…` : 'Can’t reach the data sources. Retrying…'
}

function LoadingOrError({ sources, code, season, changeEventHref }: { sources: Record<string, SourceStatus>; code: string; season: number; changeEventHref: string }) {
  const failed = Object.values(sources).filter(s => s.state !== 'off').every(s => s.state === 'error')
  if (!failed) {
    return (
      <div className="widget" style={{ maxWidth: '40rem', margin: '2rem auto' }} role="status">
        <h2 style={{ fontSize: '1.5rem' }}>Loading {code}…</h2>
        <p className="muted">Getting the schedule, rankings and stats.</p>
      </div>
    )
  }
  return (
    <div className="widget" style={{ maxWidth: '40rem', margin: '2rem auto', gap: '0.75rem' }} role="alert">
      <h2 style={{ fontSize: '1.5rem' }}>Couldn’t load {code} ({seasonLabel(season)})</h2>
      <p style={{ margin: 0 }}>{sources.ftcscout?.message ?? 'The data sources could not be reached.'}</p>
      <p className="muted" style={{ margin: 0 }}>Check the event code and season, and the internet connection. The display keeps retrying.</p>
      <p style={{ margin: 0 }}><Link className="btn outline" href={changeEventHref}>Choose a different event</Link></p>
    </div>
  )
}

/** Short spoken updates for screen-reader users: queue calls, new results and rank changes. */
function useAnnouncements(snapshot: EventSnapshot, team: number | null, queueKind: string | null, queueLabel: string | null, hasData: boolean) {
  const [message, setMessage] = useState('')
  const prev = useRef<{ kind: string | null; result: string | null; rank: number | null } | null>(null)
  const lastResult = useMemo(() => {
    if (team == null) return null
    const m = [...snapshot.matches].reverse().find(x => x.played && x.red && x.blue && x.teams.some(t => t.team === team))
    return m ?? null
  }, [snapshot.matches, team])
  const rank = team != null ? snapshot.rankings.find(r => r.team === team)?.rank ?? null : null

  useEffect(() => {
    if (!hasData || team == null) return
    const cur = { kind: queueKind, result: lastResult?.key ?? null, rank }
    const before = prev.current
    prev.current = cur
    if (!before) return
    const parts: string[] = []
    if (cur.result && cur.result !== before.result && lastResult?.red && lastResult.blue) {
      const res = resultFor(lastResult, team)
      parts.push(`${lastResult.longLabel} final: red ${lastResult.red.total}, blue ${lastResult.blue.total}.${res ? ` ${res === 'win' ? 'You won.' : res === 'loss' ? 'You lost.' : 'Tie.'}` : ''}`)
    }
    if (cur.rank != null && before.rank != null && cur.rank !== before.rank) parts.push(`You are now ranked ${ordinal(cur.rank)}.`)
    if (cur.kind !== before.kind && queueLabel) {
      if (cur.kind === 'now') parts.push(`Time to queue for ${queueLabel}.`)
      if (cur.kind === 'on-field') parts.push(`${queueLabel} is on the field.`)
    }
    if (parts.length) setMessage(parts.join(' '))
  }, [hasData, team, queueKind, queueLabel, lastResult, rank])
  return message
}

function useWakeLock(enabled: boolean) {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    if (!enabled || !nav.wakeLock) return
    let lock: { release: () => Promise<void> } | null = null
    let stopped = false
    const acquire = async () => {
      try {
        lock = await nav.wakeLock!.request('screen')
        if (stopped) void lock.release()
      } catch { /* not allowed right now */ }
    }
    void acquire()
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [enabled])
}

function useFullscreen() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const on = () => setActive(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])
  return { active, toggle }
}

function useIdleCursor(enabled: boolean) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setHidden(false)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const wake = () => {
      setHidden(false)
      clearTimeout(timer)
      timer = setTimeout(() => setHidden(true), 4000)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [enabled])
  return hidden
}
