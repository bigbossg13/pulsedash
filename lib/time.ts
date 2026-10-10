// Time helpers. Match times are kept as epoch milliseconds; the FTC Events API
// reports wall-clock times in the event's time zone without an offset, so
// those are converted here with Intl (no date library needed).

const MINUTE = 60_000

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    offsetFormatters.set(timeZone, f)
  }
  return f
}

/** Offset of `timeZone` from UTC at the given instant, in ms (e.g. -5h for Chicago in summer). */
export function zoneOffset(epoch: number, timeZone: string): number {
  const parts: Record<string, number> = {}
  for (const p of offsetFormatter(timeZone).formatToParts(new Date(epoch))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
  return asUtc - Math.floor(epoch / 1000) * 1000
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false
  try {
    offsetFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/

/**
 * Parses an ISO timestamp. Strings with an offset or "Z" are absolute; strings
 * without one are wall-clock times in `timeZone` (or the browser's zone when
 * it's unknown). Returns null for missing or placeholder (pre-2000) dates.
 */
export function parseEventTime(value: string | null | undefined, timeZone?: string | null): number | null {
  if (!value) return null
  const m = LOCAL_RE.exec(value.trim())
  if (!m) {
    const t = Date.parse(value)
    return Number.isFinite(t) && new Date(t).getUTCFullYear() > 2000 ? t : null
  }
  const [y, mo, d, h, mi, s = '0', ms = '0'] = m.slice(1)
  if (Number(y) <= 2000) return null
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms.padEnd(3, '0'))
  if (!isValidTimeZone(timeZone)) {
    return new Date(+y, +mo - 1, +d, +h, +mi, +s, +ms.padEnd(3, '0')).getTime()
  }
  // Two passes handle instants near a DST change.
  const first = wall - zoneOffset(wall, timeZone)
  const second = wall - zoneOffset(first, timeZone)
  return second
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function dateInZone(epoch: number, timeZone?: string | null): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch))
}

export type ClockPref = 'auto' | '12h' | '24h'

const clockFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatClock(epoch: number | null, timeZone: string | null | undefined, clock: ClockPref, withSeconds = false): string {
  if (epoch == null) return '–'
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined
  const key = `${tz}|${clock}|${withSeconds}`
  let f = clockFormatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      ...(clock === 'auto' ? {} : { hourCycle: clock === '24h' ? 'h23' : 'h12' }),
    })
    clockFormatters.set(key, f)
  }
  return f.format(new Date(epoch))
}

export function formatDay(epoch: number, timeZone?: string | null): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short' }).format(new Date(epoch))
}

/** "Oct 10 – 11, 2026" style range for ISO dates. */
export function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return 'Date TBA'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
  const a = new Date(`${start.slice(0, 10)}T00:00:00Z`)
  if (!end || end.slice(0, 10) === start.slice(0, 10)) return a.toLocaleDateString(undefined, opts)
  const b = new Date(`${end.slice(0, 10)}T00:00:00Z`)
  return `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${b.toLocaleDateString(undefined, opts)}`
}

/** Human duration: "45 s", "12 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < MINUTE) return `${Math.max(0, Math.round(abs / 1000))} s`
  const totalMin = Math.round(abs / MINUTE)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "in 12 min", "now", "8 min ago". */
export function formatRelative(target: number, now: number): string {
  const diff = target - now
  if (Math.abs(diff) < 30_000) return 'now'
  return diff > 0 ? `in ${formatDuration(diff)}` : `${formatDuration(diff)} ago`
}

/** FTC seasons start in September: Oct 2026 is the 2026 season. */
export function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

export function seasonLabel(season: number): string {
  return `${season}–${String(season + 1).slice(-2)}`
}
