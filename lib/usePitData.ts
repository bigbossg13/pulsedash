'use client'
// Keeps an event snapshot fresh: polls FTCScout and (through the proxy) the
// FTC Events API on their own timers, backs off when a source fails, keeps
// showing the last good data, and caches it so a reload on flaky venue Wi-Fi
// still shows something.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EventSnapshot, SeasonStats, Source, SourceData, SourceStatus } from './types'
import { fetchEventData, fetchSeasonStats } from './ftcscout'
import { DEFAULT_PROXY, fetchOfficialData, isUsableProxy } from './ftcevents'
import { mergeSnapshot } from './merge'
import { demoData } from './demo'

export interface PitDataOptions {
  season: number
  code: string
  /** Seconds between refreshes. */
  refresh: number
  /** FTC Events proxy override; empty uses the site default. */
  proxy: string
  demo: boolean
}

interface Cached {
  at: number
  scout: SourceData | null
  official: SourceData | null
  seasonStats: Record<number, SeasonStats>
}

const SEASON_STATS_EVERY = 30 * 60_000
const EVENT_INFO_EVERY = 30 * 60_000
const MAX_BACKOFF = 5 * 60_000

const cacheKey = (season: number, code: string) => `pulsedash:cache:${season}:${code}`

function readCache(season: number, code: string): Cached | null {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(season, code)) ?? 'null')
    return c && typeof c.at === 'number' ? c : null
  } catch {
    return null
  }
}

function writeCache(season: number, code: string, value: Cached) {
  try {
    localStorage.setItem(cacheKey(season, code), JSON.stringify(value))
  } catch {
    // Storage full or blocked: the display still works, it just can't restore after a reload.
  }
}

const idle = (state: SourceStatus['state']): SourceStatus => ({ state, at: null })

export function usePitData({ season, code, refresh, proxy, demo }: PitDataOptions) {
  const proxyUrl = proxy || DEFAULT_PROXY
  const officialEnabled = !demo && isUsableProxy(proxyUrl)

  const [scout, setScout] = useState<SourceData | null>(null)
  const [official, setOfficial] = useState<SourceData | null>(null)
  const [seasonStats, setSeasonStats] = useState<Record<number, SeasonStats>>({})
  const [sources, setSources] = useState<Record<Source, SourceStatus>>({
    ftcscout: idle('loading'),
    ftcEvents: idle(officialEnabled ? 'loading' : 'off'),
  })
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const wake = useRef<() => void>(() => {})

  const setStatus = useCallback((source: Source, status: Partial<SourceStatus>) => {
    setSources(s => ({ ...s, [source]: { ...s[source], ...status } }))
  }, [])

  useEffect(() => {
    if (!code) return
    let stopped = false
    const controller = new AbortController()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t)
        if (!stopped) fn()
      }, ms)
      timers.add(t)
    }

    setScout(null)
    setOfficial(null)
    setSeasonStats({})
    setRestoredAt(null)
    setSources({ ftcscout: idle(demo ? 'ok' : 'loading'), ftcEvents: idle(officialEnabled ? 'loading' : 'off') })

    if (demo) {
      const start = Date.now()
      const tick = () => {
        const d = demoData(start, Date.now())
        setScout(d.scout)
        setOfficial(d.official)
        setSeasonStats(d.seasonStats)
        setSources({ ftcscout: { state: 'ok', at: Date.now() }, ftcEvents: { state: 'ok', at: Date.now() } })
        later(tick, 5_000)
      }
      tick()
      wake.current = () => {}
      return () => {
        stopped = true
        timers.forEach(clearTimeout)
      }
    }

    const cached = readCache(season, code)
    const latest: Cached = cached ?? { at: 0, scout: null, official: null, seasonStats: {} }
    if (cached) {
      setScout(cached.scout)
      setOfficial(cached.official)
      setSeasonStats(cached.seasonStats ?? {})
      setRestoredAt(cached.at)
    }
    const persist = () => {
      latest.at = Date.now()
      writeCache(season, code, latest)
    }

    let officialOk = false
    let scoutFailures = 0
    let officialFailures = 0
    let lastEventInfo = 0
    let lastSeasonStats = 0
    let timeZone: string | null = cached?.scout?.event?.timezone ?? null
    const running = { scout: false, official: false }
    const pending = { scout: null as ReturnType<typeof setTimeout> | null, official: null as ReturnType<typeof setTimeout> | null }
    const schedule = (which: 'scout' | 'official', fn: () => void, ms: number) => {
      if (pending[which]) {
        clearTimeout(pending[which]!)
        timers.delete(pending[which]!)
      }
      const t = setTimeout(() => {
        timers.delete(t)
        pending[which] = null
        if (!stopped) fn()
      }, ms)
      pending[which] = t
      timers.add(t)
    }
    const backoff = (failures: number) => Math.min(MAX_BACKOFF, refresh * 1000 * 2 ** Math.min(failures, 5))

    const loadSeasonStats = async (teams: number[]) => {
      if (!teams.length || Date.now() - lastSeasonStats < SEASON_STATS_EVERY) return
      lastSeasonStats = Date.now()
      try {
        const stats = await fetchSeasonStats(season, teams, controller.signal)
        if (stopped) return
        latest.seasonStats = stats
        setSeasonStats(stats)
        persist()
      } catch {
        lastSeasonStats = 0
      }
    }

    const pollScout = async () => {
      if (running.scout) return
      running.scout = true
      try {
        const data = await fetchEventData(season, code, controller.signal)
        if (stopped) return
        scoutFailures = 0
        timeZone = data.event?.timezone ?? timeZone
        latest.scout = data
        setScout(data)
        setStatus('ftcscout', { state: 'ok', at: Date.now(), message: undefined })
        setRestoredAt(null)
        persist()
        void loadSeasonStats(Object.keys(data.teams ?? {}).map(Number))
        // FTCScout re-syncs about once a minute; when the official API is
        // working there's no need to ask FTCScout more often than that.
        schedule('scout', pollScout, officialOk ? Math.max(refresh, 60) * 1000 : refresh * 1000)
      } catch (err) {
        if (stopped) return
        scoutFailures++
        setStatus('ftcscout', { state: 'error', message: (err as Error).message })
        schedule('scout', pollScout, backoff(scoutFailures))
      } finally {
        running.scout = false
      }
    }

    const pollOfficial = async () => {
      if (running.official) return
      running.official = true
      try {
        const includeEvent = Date.now() - lastEventInfo > EVENT_INFO_EVERY
        const data = await fetchOfficialData(proxyUrl, season, code, { includeEvent, timeZone }, controller.signal)
        if (stopped) return
        if (includeEvent) lastEventInfo = Date.now()
        officialOk = true
        officialFailures = 0
        timeZone = data.event?.timezone ?? timeZone
        // Keep event/team details from earlier loads when this poll skipped them.
        const merged: SourceData = { ...latest.official, ...data }
        latest.official = merged
        setOfficial(merged)
        setStatus('ftcEvents', { state: 'ok', at: Date.now(), message: undefined })
        setRestoredAt(null)
        persist()
        schedule('official', pollOfficial, refresh * 1000)
      } catch (err) {
        if (stopped) return
        officialOk = false
        officialFailures++
        setStatus('ftcEvents', { state: 'error', message: (err as Error).message })
        schedule('official', pollOfficial, backoff(officialFailures))
      } finally {
        running.official = false
      }
    }

    wake.current = () => {
      void pollScout()
      if (officialEnabled) void pollOfficial()
    }
    wake.current()

    let lastWake = Date.now()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastWake > refresh * 1000) {
        lastWake = Date.now()
        wake.current()
      }
    }
    const onOnline = () => wake.current()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      stopped = true
      controller.abort()
      timers.forEach(clearTimeout)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [season, code, refresh, proxyUrl, officialEnabled, demo, setStatus])

  const snapshot: EventSnapshot = useMemo(
    () => mergeSnapshot(scout, official, seasonStats, sources),
    [scout, official, seasonStats, sources],
  )

  const refreshNow = useCallback(() => wake.current(), [])

  return { snapshot, refreshNow, restoredAt, hasData: !!(scout || official) }
}
