'use client'
// Settings for one team's display. Every change applies immediately (so the
// display behind the dialog previews it) and is saved on this device.
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  BRAND_ORANGE, LAYOUT_PRESETS, MAX_LOGO_BYTES, WIDGET_IDS, defaultPrefs, encodePrefs, isSafeLogo, isSafeProxy,
  parseHex, sanitizeColumns, sanitizePrefs, type PitPrefs, type WidgetId,
} from '@/lib/settings'
import { DEFAULT_PROXY } from '@/lib/ftcevents'
import type { SourceStatus } from '@/lib/types'
import { WIDGETS } from './widgets'
import { ArrowIcon, TrashIcon } from './icons'

const TABS = [
  { id: 'layout', label: 'Layout' },
  { id: 'look', label: 'Look & accessibility' },
  { id: 'team', label: 'Team' },
  { id: 'timing', label: 'Match timing' },
  { id: 'data', label: 'Data & screen' },
  { id: 'share', label: 'Share & backup' },
] as const
type TabId = (typeof TABS)[number]['id']

const TEAM_COLORS = ['#ff9b25', '#c62828', '#1d5fd1', '#2e7d32', '#6a1b9a', '#00838f', '#f9a825', '#37474f', '#d81b60', '#000000']

export interface SettingsProps {
  open: boolean
  onClose: () => void
  prefs: PitPrefs
  onChange: (p: PitPrefs) => void
  team: number | null
  season: number
  eventCode: string
  demo: boolean
  ftcEvents: SourceStatus
  onSwitchTeam: (team: number | null) => void
  changeEventHref: string
}

export default function SettingsDialog(props: SettingsProps) {
  const { open, onClose, prefs, onChange, team } = props
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<TabId>('layout')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const baseId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const set = <K extends keyof PitPrefs>(key: K, value: PitPrefs[K]) => onChange(sanitizePrefs({ ...prefs, [key]: value }, team))

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    let next = i + delta
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = TABS.length - 1
    if (next === i) return
    e.preventDefault()
    const t = TABS[(next + TABS.length) % TABS.length]
    setTab(t.id)
    tabRefs.current[t.id]?.focus()
  }

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby={`${baseId}-title`}
      onClose={onClose}
      onCancel={onClose}
      onClick={e => { if (e.target === ref.current) onClose() }}
    >
      <div className="settings-inner">
        <div className="settings-nav">
          <h2 id={`${baseId}-title`}>Settings</h2>
          <div className="settings-tabs" role="tablist" aria-orientation="vertical" aria-labelledby={`${baseId}-title`}>
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={el => { tabRefs.current[t.id] = el }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`${baseId}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={e => onTabKey(e, i)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-body">
          <div className="settings-panel" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`} tabIndex={0}>
            {tab === 'layout' && <LayoutTab {...props} set={set} />}
            {tab === 'look' && <LookTab {...props} set={set} />}
            {tab === 'team' && <TeamTab {...props} set={set} />}
            {tab === 'timing' && <TimingTab {...props} set={set} />}
            {tab === 'data' && <DataTab {...props} set={set} />}
            {tab === 'share' && <ShareTab {...props} />}
          </div>
          <div className="settings-foot">
            <span className="hint">
              {props.demo ? 'Demo settings are saved on this device.' : `Saved automatically on this device${team != null ? ` for team ${team}` : ''}.`}
            </span>
            <button type="button" className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
      <button type="button" className="sr-only" onClick={onClose}>Close settings</button>
    </dialog>
  )
}

type TabProps = SettingsProps & { set: <K extends keyof PitPrefs>(key: K, value: PitPrefs[K]) => void }

function Radio<T extends string>({ legend, name, value, options, onChange, hint }: {
  legend: string
  name: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
}) {
  const id = useId()
  return (
    <fieldset aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend>{legend}</legend>
      <div className="seg">
        {options.map(o => (
          <label key={o.value}>
            <input type="radio" name={`${name}-${id}`} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
    </fieldset>
  )
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId()
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-describedby={hint ? id : undefined} />
        <span>{label}</span>
      </label>
      {hint ? <p className="hint" id={id} style={{ marginLeft: '2rem' }}>{hint}</p> : null}
    </div>
  )
}

// ── Layout ───────────────────────────────────────────────────────────────────

function LayoutTab({ prefs, onChange, team, set }: TabProps) {
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const cols = prefs.columns
  const shown = new Set(cols.flat())
  const hidden = WIDGET_IDS.filter(id => !shown.has(id))
  const presetId = LAYOUT_PRESETS.find(p => JSON.stringify(p.columns) === JSON.stringify(cols))?.id

  useEffect(() => {
    if (!focusTarget) return
    const el = document.getElementById(focusTarget) as HTMLButtonElement | null
    if (el && !el.disabled) el.focus()
    else (document.getElementById(focusTarget.replace(/-(up|down|left|right)$/, '-remove')) as HTMLElement | null)?.focus()
    setFocusTarget(null)
  }, [focusTarget, cols])

  const apply = (next: WidgetId[][], msg: string, focus?: string) => {
    const clean = sanitizeColumns(next.filter(c => c.length))
    if (!clean) return
    onChange(sanitizePrefs({ ...prefs, columns: clean }, team))
    setStatus(msg)
    if (focus) setFocusTarget(focus)
  }
  const move = (id: WidgetId, dir: 'up' | 'down' | 'left' | 'right') => {
    const next = cols.map(c => [...c])
    const ci = next.findIndex(c => c.includes(id))
    const wi = next[ci].indexOf(id)
    if (dir === 'up' || dir === 'down') {
      const to = wi + (dir === 'up' ? -1 : 1)
      if (to < 0 || to >= next[ci].length) return
      ;[next[ci][wi], next[ci][to]] = [next[ci][to], next[ci][wi]]
    } else {
      const to = ci + (dir === 'left' ? -1 : 1)
      if (to < 0 || to >= next.length) return
      next[ci].splice(wi, 1)
      next[to].push(id)
    }
    apply(next, `${WIDGETS[id].title} moved ${dir}.`, `w-${id}-${dir}`)
  }
  const remove = (id: WidgetId) => {
    if (cols.flat().length <= 1) return
    apply(cols.map(c => c.filter(w => w !== id)), `${WIDGETS[id].title} removed.`)
  }
  const add = (ci: number, id: WidgetId) => {
    const next = cols.map(c => [...c])
    if (ci >= next.length) next.push([id])
    else next[ci].push(id)
    apply(next, `${WIDGETS[id].title} added.`, `w-${id}-remove`)
  }

  return (
    <>
      <h3>Layout</h3>
      <fieldset>
        <legend>Start from a preset</legend>
        <div className="preset-grid">
          {LAYOUT_PRESETS.map(p => (
            <button key={p.id} type="button" className="preset" aria-pressed={presetId === p.id} onClick={() => set('columns', p.columns)}>
              <strong>{p.name}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Columns</h3>
        <p className="hint" style={{ marginBottom: '0.75rem' }}>Up to three columns. Widgets stack top to bottom; use the arrows to move them.</p>
        <div className="col-editor">
          {[...cols, ...(cols.length < 3 ? [[] as WidgetId[]] : [])].map((col, ci) => (
            <div key={ci} className="col-box" role="group" aria-label={ci < cols.length ? `Column ${ci + 1}` : 'New column'}>
              <h4>{ci < cols.length ? `Column ${ci + 1}` : 'New column'}</h4>
              {col.map((id, wi) => (
                <div key={id} className="col-item">
                  <span>{WIDGETS[id].title}</span>
                  <button type="button" id={`w-${id}-up`} aria-label={`Move ${WIDGETS[id].title} up`} disabled={wi === 0} onClick={() => move(id, 'up')}><ArrowIcon dir="up" /></button>
                  <button type="button" id={`w-${id}-down`} aria-label={`Move ${WIDGETS[id].title} down`} disabled={wi === col.length - 1} onClick={() => move(id, 'down')}><ArrowIcon dir="down" /></button>
                  <button type="button" id={`w-${id}-left`} aria-label={`Move ${WIDGETS[id].title} to the left column`} disabled={ci === 0} onClick={() => move(id, 'left')}><ArrowIcon dir="left" /></button>
                  <button type="button" id={`w-${id}-right`} aria-label={`Move ${WIDGETS[id].title} to the right column`} disabled={ci >= cols.length - 1} onClick={() => move(id, 'right')}><ArrowIcon dir="right" /></button>
                  <button type="button" id={`w-${id}-remove`} aria-label={`Remove ${WIDGETS[id].title}`} disabled={cols.flat().length <= 1} onClick={() => remove(id)}><TrashIcon /></button>
                </div>
              ))}
              {hidden.length ? (
                <AddWidget hidden={hidden} onAdd={id => add(ci, id)} label={ci < cols.length ? `Add a widget to column ${ci + 1}` : 'Add a widget in a new column'} />
              ) : null}
            </div>
          ))}
        </div>
        <p className="sr-only" role="status">{status}</p>
      </div>
      {team == null ? <p className="notice">Widgets about your team need a team number (Team tab).</p> : null}
      <div>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>What each widget shows</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.375rem 1rem', margin: 0, fontSize: '0.9375rem' }}>
          {WIDGET_IDS.map(id => (
            <div key={id} style={{ display: 'contents' }}>
              <dt style={{ fontWeight: 600 }}>{WIDGETS[id].title}</dt>
              <dd style={{ margin: 0, color: 'var(--muted)' }}>{WIDGETS[id].description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  )
}

function AddWidget({ hidden, onAdd, label }: { hidden: WidgetId[]; onAdd: (id: WidgetId) => void; label: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value="" onChange={e => { if (e.target.value) onAdd(e.target.value as WidgetId) }}>
        <option value="">+ Add widget…</option>
        {hidden.map(w => <option key={w} value={w}>{WIDGETS[w].title}</option>)}
      </select>
    </div>
  )
}

// ── Look ─────────────────────────────────────────────────────────────────────

function LookTab({ prefs, set }: TabProps) {
  const colorId = useId()
  const accent = prefs.accent || BRAND_ORANGE
  return (
    <>
      <h3>Look &amp; accessibility</h3>
      <Radio legend="Theme" name="theme" value={prefs.theme} onChange={v => set('theme', v)}
        options={[{ value: 'auto', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'contrast', label: 'High contrast' }]}
        hint="High contrast uses black, white and yellow with thicker outlines." />
      <Radio legend="Text size" name="text" value={prefs.textSize} onChange={v => set('textSize', v)}
        options={[{ value: 'm', label: 'Standard' }, { value: 'l', label: 'Large' }, { value: 'xl', label: 'Extra large' }, { value: 'xxl', label: 'Huge' }]}
        hint="Text already grows with the screen; this makes everything larger still for reading from a distance." />
      <Radio legend="Font" name="font" value={prefs.font} onChange={v => set('font', v)}
        options={[{ value: 'brand', label: 'PulseDash' }, { value: 'readable', label: 'Atkinson Hyperlegible' }]}
        hint="Atkinson Hyperlegible was designed for low-vision readers: every letter and number is easy to tell apart." />
      <Radio legend="Motion" name="motion" value={prefs.motion} onChange={v => set('motion', v)}
        options={[{ value: 'auto', label: 'Match device' }, { value: 'reduce', label: 'Reduce motion' }]}
        hint="Reduced motion turns off smooth scrolling; long lists flip pages every 12 seconds instead." />
      <fieldset>
        <legend>Team color</legend>
        <p className="hint">Highlights your team everywhere on the display. Pick a preset, use the color picker, or type any hex code. Text on it switches between black and white automatically so it stays readable.</p>
        <div className="swatches">
          {TEAM_COLORS.map(c => (
            <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={accent === c}
              aria-label={c === BRAND_ORANGE ? 'PulseDash orange' : `Color ${c}`} onClick={() => set('accent', c === BRAND_ORANGE ? '' : c)} />
          ))}
          <label htmlFor={colorId} className="sr-only">Pick a team color</label>
          <input id={colorId} type="color" value={accent} onChange={e => set('accent', e.target.value)} />
        </div>
        <HexField value={accent} onCommit={hex => set('accent', hex === BRAND_ORANGE ? '' : hex)} />
      </fieldset>
      <Radio legend="Clock" name="clock" value={prefs.clock} onChange={v => set('clock', v)}
        options={[{ value: 'auto', label: 'Match device' }, { value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} />
    </>
  )
}

// ── Team ─────────────────────────────────────────────────────────────────────

function TeamTab({ prefs, set, team, onSwitchTeam, changeEventHref, demo }: TabProps) {
  const ids = { team: useId(), name: useId(), logo: useId(), upload: useId(), msg: useId(), list: useId(), watch: useId() }
  const [teamInput, setTeamInput] = useState(team?.toString() ?? '')
  const [logoInput, setLogoInput] = useState(prefs.logo.startsWith('data:') ? '' : prefs.logo)
  const [logoError, setLogoError] = useState('')
  const [checklist, setChecklist] = useState(prefs.checklist.join('\n'))
  const [watch, setWatch] = useState(prefs.watch.join(', '))

  const upload = async (file: File | undefined) => {
    setLogoError('')
    if (!file) return
    try {
      const url = await shrinkImage(file)
      if (url.length > MAX_LOGO_BYTES || !isSafeLogo(url)) throw new Error('too big')
      set('logo', url)
    } catch {
      setLogoError('That image could not be used. Try a PNG or JPEG under 2 MB.')
    }
  }

  return (
    <>
      <h3>Team</h3>
      {!demo ? (
        <form className="row" onSubmit={e => {
          e.preventDefault()
          const n = Number(teamInput)
          onSwitchTeam(teamInput.trim() === '' ? null : Number.isInteger(n) && n > 0 ? n : team)
        }}>
          <div className="field">
            <label htmlFor={ids.team}>Team number</label>
            <input id={ids.team} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={teamInput} onChange={e => setTeamInput(e.target.value.replace(/\D/g, ''))} aria-describedby={`${ids.team}-h`} />
          </div>
          <button type="submit" className="btn outline">Switch team</button>
          <Link className="btn ghost" href={changeEventHref}>Change event</Link>
          <p className="hint" id={`${ids.team}-h`} style={{ flexBasis: '100%' }}>Each team keeps its own settings. Leave empty to show the whole event without a team.</p>
        </form>
      ) : null}
      <div className="field">
        <label htmlFor={ids.name}>Name on the display</label>
        <input id={ids.name} type="text" maxLength={60} value={prefs.displayName} placeholder="Uses your registered team name" onChange={e => set('displayName', e.target.value)} />
      </div>
      <fieldset>
        <legend>Logo</legend>
        <div className="row">
          <div className="field">
            <label htmlFor={ids.logo}>Image link (https)</label>
            <input id={ids.logo} type="url" value={logoInput} placeholder="https://…" onChange={e => setLogoInput(e.target.value)}
              onBlur={() => { if (!logoInput) { if (!prefs.logo.startsWith('data:')) set('logo', '') } else if (isSafeLogo(logoInput)) set('logo', logoInput); else setLogoError('Use a link that starts with https://') }} />
          </div>
          <div className="field">
            <label htmlFor={ids.upload}>…or upload</label>
            <input id={ids.upload} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => upload(e.target.files?.[0])} />
          </div>
        </div>
        {logoError ? <p className="notice error" role="alert">{logoError}</p> : null}
        {prefs.logo ? (
          <div className="row" style={{ alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={prefs.logo} alt="Current logo" className="logo-preview" />
            <button type="button" className="btn ghost small" onClick={() => { set('logo', ''); setLogoInput('') }}>Remove logo</button>
          </div>
        ) : null}
        <p className="hint">Uploaded logos stay on this device and aren’t included in share links. Use an image link to share it.</p>
      </fieldset>
      <div className="field">
        <label htmlFor={ids.msg}>Welcome message</label>
        <textarea id={ids.msg} maxLength={280} value={prefs.message} placeholder="Welcome to our pit! Ask us about our robot." onChange={e => set('message', e.target.value)} aria-describedby={`${ids.msg}-h`} />
        <p className="hint" id={`${ids.msg}-h`}>Shown in the Welcome widget. {280 - prefs.message.length} characters left.</p>
      </div>
      <div className="field">
        <label htmlFor={ids.list}>Pre-match checklist</label>
        <textarea id={ids.list} value={checklist} onChange={e => setChecklist(e.target.value)} onBlur={() => set('checklist', checklist.split('\n'))} aria-describedby={`${ids.list}-h`} />
        <p className="hint" id={`${ids.list}-h`}>One item per line, up to 12. Ticks reset for every match.</p>
      </div>
      <div className="field">
        <label htmlFor={ids.watch}>Teams to highlight</label>
        <input id={ids.watch} type="text" inputMode="numeric" value={watch} placeholder="e.g. 12345, 6789"
          onChange={e => setWatch(e.target.value)}
          onBlur={() => set('watch', watch.split(/[^0-9]+/).filter(Boolean).map(Number))} aria-describedby={`${ids.watch}-h`} />
        <p className="hint" id={`${ids.watch}-h`}>Alliance partners, friends or teams you’re scouting. They’re marked with ★ and a tint.</p>
      </div>
    </>
  )
}

/** Scales an uploaded image down to at most 480px and returns a data URL. */
async function shrinkImage(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error('too big')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const webp = canvas.toDataURL('image/webp', 0.85)
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Timing ───────────────────────────────────────────────────────────────────

function NumberField({ label, value, min, max, step = 1, onChange, hint, suffix }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; hint?: string; suffix?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = (v: number) => Number.isFinite(v) && v >= min && v <= max
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <input id={id} type="number" min={min} max={max} step={step} value={draft} style={{ maxWidth: '8rem' }}
          onChange={e => {
            setDraft(e.target.value)
            const v = Number(e.target.value)
            if (e.target.value !== '' && valid(v)) onChange(v)
          }}
          onBlur={() => setDraft(String(value))}
          aria-describedby={hint ? `${id}-h` : undefined} />
        {suffix ? <span>{suffix}</span> : null}
      </div>
      {hint ? <p className="hint" id={`${id}-h`}>{hint}</p> : null}
    </div>
  )
}

function TimingTab({ prefs, set }: TabProps) {
  return (
    <>
      <h3>Match timing</h3>
      <p className="hint">“Queue now” shows when either rule below is met. Set a rule to 0 to turn it off.</p>
      <div className="grid-2">
        <NumberField label="Queue before the match" suffix="minutes" value={prefs.queueMinutes} min={0} max={60} onChange={v => set('queueMinutes', v)}
          hint="Based on the estimated start time." />
        <NumberField label="…or when this many matches are ahead" suffix="matches" value={prefs.queueMatches} min={0} max={10} onChange={v => set('queueMatches', v)}
          hint="Many events call teams to queue a few matches early." />
      </div>
      <Toggle label="Adjust times when the event runs late" checked={prefs.adjustForDelay} onChange={v => set('adjustForDelay', v)}
        hint="Uses the actual start of recent matches to estimate when yours will start. Breaks in the schedule soak up the delay." />
    </>
  )
}

// ── Data & screen ────────────────────────────────────────────────────────────

function DataTab({ prefs, set, ftcEvents }: TabProps) {
  const id = useId()
  const [proxy, setProxy] = useState(prefs.proxy)
  const [error, setError] = useState('')
  const effective = prefs.proxy || DEFAULT_PROXY
  return (
    <>
      <h3>Data &amp; screen</h3>
      <NumberField label="Refresh every" suffix="seconds" value={prefs.refresh} min={15} max={300} step={5} onChange={v => set('refresh', v)}
        hint="FTCScout updates about once a minute. With the FTC Events API connected, new results show within seconds." />
      <Radio legend="OPR to show and predict with" name="opr" value={prefs.opr} onChange={v => set('opr', v)}
        options={[{ value: 'np', label: 'No-penalty OPR' }, { value: 'total', label: 'Total OPR' }]}
        hint="No-penalty OPR leaves out points from the other alliance’s fouls, so it predicts better." />
      <div className="field">
        <label htmlFor={id}>FTC Events API proxy</label>
        <input id={id} type="url" value={proxy} placeholder={DEFAULT_PROXY || 'https://your-proxy.workers.dev'} onChange={e => setProxy(e.target.value)}
          onBlur={() => {
            setError('')
            if (!proxy.trim()) set('proxy', '')
            else if (isSafeProxy(proxy.trim())) set('proxy', proxy.trim())
            else setError('Use an https:// address.')
          }} aria-describedby={`${id}-h`} />
        {error ? <p className="notice error" role="alert">{error}</p> : null}
        <p className="hint" id={`${id}-h`}>
          {effective
            ? `Status: ${ftcEvents.state === 'ok' ? 'connected' : ftcEvents.state === 'error' ? `not reachable (${ftcEvents.message ?? 'error'})` : ftcEvents.state === 'loading' ? 'connecting…' : 'off'}. `
            : 'Not set: the display uses FTCScout only. '}
          The official API needs a key, so it’s reached through a small proxy you can host for free. See proxy/README.md in the PulseDash repository.
        </p>
      </div>
      <NexusFields prefs={prefs} set={set} />
      <Toggle label="Scroll long lists automatically" checked={prefs.autoScroll} onChange={v => set('autoScroll', v)}
        hint="Rankings and the field queue scroll slowly so a mounted screen shows every row. Each list has a pause button." />
      <Toggle label="Keep the screen awake" checked={prefs.keepAwake} onChange={v => set('keepAwake', v)}
        hint="Stops laptops and tablets from sleeping while the display is open (supported browsers only)." />
      <Toggle label="Hide the mouse pointer when idle" checked={prefs.hideCursor} onChange={v => set('hideCursor', v)} />
    </>
  )
}

// ── Share & backup ───────────────────────────────────────────────────────────

function ShareTab({ prefs, onChange, team }: SettingsProps) {
  const linkId = useId()
  const fileId = useId()
  const [copied, setCopied] = useState('')
  const [importError, setImportError] = useState('')
  const link = typeof window === 'undefined' ? '' : `${window.location.href.split('#')[0]}#prefs=${encodePrefs(prefs, team)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('Link copied.')
    } catch {
      ;(document.getElementById(linkId) as HTMLInputElement | null)?.select()
      setCopied('Press Ctrl+C (or ⌘C) to copy the selected link.')
    }
  }
  const download = () => {
    const { nexusKey: _key, ...shareable } = prefs // eslint-disable-line @typescript-eslint/no-unused-vars
    const blob = new Blob([JSON.stringify({ app: 'pulsedash', team, prefs: shareable }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `pulsedash-${team ?? 'event'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const load = async (file: File | undefined) => {
    setImportError('')
    if (!file) return
    try {
      const json = JSON.parse(await file.text())
      onChange(sanitizePrefs({ ...(json.prefs ?? json), nexusKey: prefs.nexusKey }, team))
      setCopied('Settings imported.')
    } catch {
      setImportError('That file isn’t a PulseDash settings file.')
    }
  }
  return (
    <>
      <h3>Share &amp; backup</h3>
      <div className="field">
        <label htmlFor={linkId}>Share link</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input id={linkId} type="text" readOnly value={link} onFocus={e => e.target.select()} />
          <button type="button" className="btn primary" onClick={copy}>Copy</button>
        </div>
        <p className="hint">Open this link on the pit TV, a teammate’s laptop or a tablet to get the same display and settings.</p>
      </div>
      <div className="row">
        <button type="button" className="btn outline" onClick={download}>Download settings file</button>
        <div className="field" style={{ flex: '1 1 14rem' }}>
          <label htmlFor={fileId}>Load a settings file</label>
          <input id={fileId} type="file" accept="application/json,.json" onChange={e => load(e.target.files?.[0])} />
        </div>
      </div>
      {importError ? <p className="notice error" role="alert">{importError}</p> : null}
      <p className="toast" role="status">{copied}</p>
      <div>
        <button type="button" className="btn ghost" onClick={() => {
          if (window.confirm('Reset every setting for this team to the defaults?')) onChange({ ...defaultPrefs(team), nexusKey: prefs.nexusKey })
        }}>
          Reset to defaults
        </button>
      </div>
    </>
  )
}


function NexusFields({ prefs, set }: { prefs: PitPrefs; set: TabProps['set'] }) {
  const ids = { key: useId(), event: useId() }
  const [key, setKey] = useState(prefs.nexusKey)
  const [event, setEvent] = useState(prefs.nexusEvent)
  return (
    <fieldset>
      <legend>FTC Nexus (live queuing)</legend>
      <p className="hint">
        At events that use <a href="https://ftc.nexus/" target="_blank" rel="noreferrer">FTC Nexus</a>, the display takes queue calls,
        time estimates, announcements and parts requests straight from the queue crew. Get a free API key at{' '}
        <a href="https://ftc.nexus/en/api" target="_blank" rel="noreferrer">ftc.nexus/en/api</a>.
      </p>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={ids.key}>Nexus API key</label>
          <input id={ids.key} type="password" autoComplete="off" spellCheck={false} value={key}
            onChange={e => setKey(e.target.value)} onBlur={() => set('nexusKey', key.trim())} aria-describedby={`${ids.key}-h`} />
          <p className="hint" id={`${ids.key}-h`}>Saved on this device only. Never included in share links or settings files you share.</p>
        </div>
        <div className="field">
          <label htmlFor={ids.event}>Nexus event key</label>
          <input id={ids.event} type="text" autoComplete="off" spellCheck={false} value={event} placeholder="Automatic"
            onChange={e => setEvent(e.target.value)} onBlur={() => set('nexusEvent', event.trim())} aria-describedby={`${ids.event}-h`} />
          <p className="hint" id={`${ids.event}-h`}>Leave empty to use season + event code (e.g. 2026usxxq1). Set it only if Nexus uses a different key.</p>
        </div>
      </div>
    </fieldset>
  )
}

function HexField({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(value); setError('') }, [value])
  const commit = () => {
    const hex = parseHex(draft)
    if (hex) {
      setError('')
      onCommit(hex)
    } else {
      setError('Use a hex code like #1E88E5 or #18E.')
    }
  }
  const preview = parseHex(draft)
  return (
    <div className="field" style={{ maxWidth: '20rem' }}>
      <label htmlFor={id}>Hex code</label>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        <span className="swatch" aria-hidden style={{ background: preview ?? 'transparent', flexShrink: 0 }} />
        <input id={id} type="text" inputMode="text" autoComplete="off" spellCheck={false} maxLength={7} value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          aria-invalid={!!error} aria-describedby={`${id}-h`} style={{ fontFamily: 'var(--mono)' }} />
      </div>
      <p className={error ? 'notice error' : 'hint'} id={`${id}-h`} role={error ? 'alert' : undefined}>
        {error || 'Type your team\u2019s exact color, e.g. #1E88E5. Press Enter to apply.'}
      </p>
    </div>
  )
}
