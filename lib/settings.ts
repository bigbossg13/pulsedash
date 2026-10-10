// Display preferences. Each team keeps its own profile on the device
// (localStorage, keyed by team number) and can move it to another screen
// with a share link or a JSON file. Everything read from storage, links or
// files goes through sanitizePrefs(), so a bad value can't break the display.

export const WIDGET_IDS = [
  'next-match', 'team-status', 'match-preview', 'our-schedule', 'last-result',
  'rankings', 'upcoming', 'alliances', 'checklist', 'message', 'announcements',
] as const
export type WidgetId = (typeof WIDGET_IDS)[number]

export type Theme = 'auto' | 'light' | 'dark' | 'contrast'
export type TextSize = 'm' | 'l' | 'xl' | 'xxl'
export type FontChoice = 'brand' | 'readable'
export type MotionPref = 'auto' | 'reduce'
export type Clock = 'auto' | '12h' | '24h'

export interface PitPrefs {
  v: 1
  /** Up to three columns of widgets, left to right, top to bottom. */
  columns: WidgetId[][]
  theme: Theme
  textSize: TextSize
  font: FontChoice
  motion: MotionPref
  /** Team color as #rrggbb; empty for PulseDash orange. */
  accent: string
  clock: Clock
  /** Overrides the team name in the header. */
  displayName: string
  /** https:// image URL or an uploaded data: URL. */
  logo: string
  message: string
  checklist: string[]
  /** Teams to highlight (partners, rivals, friends). */
  watch: number[]
  queueMinutes: number
  queueMatches: number
  adjustForDelay: boolean
  /** Seconds between refreshes. */
  refresh: number
  /** FTC Events proxy URL; empty uses the site default. */
  proxy: string
  /** Personal FTC Nexus API key. Stays on this device: never in share links. */
  nexusKey: string
  /** Nexus event key when it isn't season + event code. */
  nexusEvent: string
  opr: 'np' | 'total'
  autoScroll: boolean
  keepAwake: boolean
  hideCursor: boolean
}

export interface LayoutPreset {
  id: string
  name: string
  description: string
  columns: WidgetId[][]
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'overview',
    name: 'Pit overview',
    description: 'Next match, standing, schedule and rankings side by side.',
    columns: [['next-match', 'match-preview'], ['team-status', 'our-schedule'], ['rankings']],
  },
  {
    id: 'focus',
    name: 'Match focus',
    description: 'Big next-match card with the pre-match checklist. Good for the drive team.',
    columns: [['next-match', 'checklist'], ['our-schedule', 'announcements']],
  },
  {
    id: 'scouting',
    name: 'Scouting',
    description: 'Predictions, the field queue and full rankings.',
    columns: [['match-preview', 'upcoming'], ['rankings', 'alliances']],
  },
  {
    id: 'visitors',
    name: 'Visitors',
    description: 'Your message for people stopping by, plus how you are doing.',
    columns: [['message', 'team-status'], ['next-match', 'our-schedule']],
  },
  {
    id: 'event',
    name: 'Whole event',
    description: 'No team selected: what is on the field and the standings.',
    columns: [['upcoming', 'alliances'], ['rankings']],
  },
]

export const DEFAULT_PREFS: PitPrefs = {
  v: 1,
  columns: LAYOUT_PRESETS[0].columns,
  theme: 'auto',
  textSize: 'm',
  font: 'brand',
  motion: 'auto',
  accent: '',
  clock: 'auto',
  displayName: '',
  logo: '',
  message: '',
  checklist: ['Battery charged and strapped in', 'Controllers paired and charged', 'Robot powered on and initialized', 'Correct autonomous selected'],
  watch: [],
  queueMinutes: 10,
  queueMatches: 2,
  adjustForDelay: true,
  refresh: 30,
  proxy: '',
  nexusKey: '',
  nexusEvent: '',
  opr: 'np',
  autoScroll: true,
  keepAwake: true,
  hideCursor: true,
}

export function defaultPrefs(team: number | null): PitPrefs {
  return team == null ? { ...DEFAULT_PREFS, columns: LAYOUT_PRESETS.find(p => p.id === 'event')!.columns } : { ...DEFAULT_PREFS }
}

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
// Not trimmed: values are sanitized on every keystroke, so trimming would eat the space being typed.
const text = (v: unknown, max: number, newlines = false) =>
  typeof v === 'string'
    ? Array.from(v, c => ((c < ' ' && !(newlines && c === '\n')) || c === '\u007f' ? ' ' : c)).join('').slice(0, max)
    : ''

export const MAX_LOGO_BYTES = 400_000

export function isSafeLogo(v: string): boolean {
  if (v.startsWith('data:')) return /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_LOGO_BYTES
  try {
    return new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}

export function isSafeProxy(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
  } catch {
    return false
  }
}

export function sanitizeColumns(v: unknown): WidgetId[][] | null {
  if (!Array.isArray(v)) return null
  const seen = new Set<WidgetId>()
  const cols = v.slice(0, 3).map(col =>
    (Array.isArray(col) ? col : []).filter((id): id is WidgetId => {
      if (!(WIDGET_IDS as readonly unknown[]).includes(id) || seen.has(id as WidgetId)) return false
      seen.add(id as WidgetId)
      return true
    }),
  )
  const nonEmpty = cols.filter(c => c.length)
  return nonEmpty.length ? nonEmpty : null
}

export function sanitizePrefs(input: unknown, team: number | null = null): PitPrefs {
  const d = defaultPrefs(team)
  if (!input || typeof input !== 'object') return d
  const p = input as Record<string, unknown>
  const accent = typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent.toLowerCase() : ''
  const logo = typeof p.logo === 'string' && isSafeLogo(p.logo) ? p.logo : ''
  const proxy = typeof p.proxy === 'string' && isSafeProxy(p.proxy) ? p.proxy.trim() : ''
  return {
    v: 1,
    columns: sanitizeColumns(p.columns) ?? d.columns,
    theme: oneOf(p.theme, ['auto', 'light', 'dark', 'contrast'], d.theme),
    textSize: oneOf(p.textSize, ['m', 'l', 'xl', 'xxl'], d.textSize),
    font: oneOf(p.font, ['brand', 'readable'], d.font),
    motion: oneOf(p.motion, ['auto', 'reduce'], d.motion),
    accent,
    clock: oneOf(p.clock, ['auto', '12h', '24h'], d.clock),
    displayName: text(p.displayName, 60),
    logo,
    message: text(p.message, 280, true),
    checklist: Array.isArray(p.checklist) ? p.checklist.map(i => text(i, 80).trim()).filter(Boolean).slice(0, 12) : d.checklist,
    watch: Array.isArray(p.watch)
      ? [...new Set(p.watch.filter((n): n is number => Number.isInteger(n) && n > 0 && n < 100000))].slice(0, 24)
      : d.watch,
    queueMinutes: clampInt(p.queueMinutes, 0, 60, d.queueMinutes),
    queueMatches: clampInt(p.queueMatches, 0, 10, d.queueMatches),
    adjustForDelay: bool(p.adjustForDelay, d.adjustForDelay),
    refresh: clampInt(p.refresh, 15, 300, d.refresh),
    proxy,
    nexusKey: typeof p.nexusKey === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(p.nexusKey.trim()) ? p.nexusKey.trim() : '',
    nexusEvent: typeof p.nexusEvent === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.nexusEvent.trim()) ? p.nexusEvent.trim().toLowerCase() : '',
    opr: oneOf(p.opr, ['np', 'total'], d.opr),
    autoScroll: bool(p.autoScroll, d.autoScroll),
    keepAwake: bool(p.keepAwake, d.keepAwake),
    hideCursor: bool(p.hideCursor, d.hideCursor),
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

export const prefsKey = (team: number | null) => `pulsedash:prefs:${team ?? 'event'}`

export function loadPrefs(team: number | null): PitPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(team))
    return sanitizePrefs(raw ? JSON.parse(raw) : null, team)
  } catch {
    return defaultPrefs(team)
  }
}

export function savePrefs(team: number | null, prefs: PitPrefs): boolean {
  try {
    localStorage.setItem(prefsKey(team), JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

// ── Share links ──────────────────────────────────────────────────────────────

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

/** Only values that differ from the defaults, without uploaded logos (too big for a link) or API keys. */
export function encodePrefs(prefs: PitPrefs, team: number | null): string {
  const d = defaultPrefs(team)
  const diff: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(prefs)) {
    if (k === 'logo' && typeof v === 'string' && v.startsWith('data:')) continue
    if (k === 'nexusKey') continue
    if (JSON.stringify(v) !== JSON.stringify(d[k as keyof PitPrefs])) diff[k] = v
  }
  return toBase64Url(JSON.stringify(diff))
}

export function decodePrefs(encoded: string, team: number | null): PitPrefs | null {
  try {
    return sanitizePrefs({ ...defaultPrefs(team), ...JSON.parse(fromBase64Url(encoded)) }, team)
  } catch {
    return null
  }
}

// ── Colors ───────────────────────────────────────────────────────────────────

/** "#1e88e5", "1E88E5", "#18e" → "#1e88e5"; anything else → null. */
export function parseHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return `#${h.toLowerCase()}`
}

export const BRAND_ORANGE = '#ff9b25'

function luminance(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on `bg`. One of them always reaches 4.5:1. */
export function readableInk(bg: string): '#000000' | '#ffffff' {
  return contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff'
}
