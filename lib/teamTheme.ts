// Turns a team's colors into the display's theme: header, buttons, links,
// highlights and a light tint on the background. Every text/background pair is
// pushed until it reaches WCAG AA contrast, so any color a team picks stays
// readable.
import { contrastRatio, readableInk } from './settings'

const LIGHT = { ground: '#f4f2ec', panel: '#ffffff', panel2: '#faf8f4', ink: '#15171c' }
const DARK = { ground: '#111317', panel: '#1a1d23', panel2: '#20242b', ink: '#eceef2' }

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => `#${c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

/** Blend `a` into `b`: amount 0 = b, 1 = a. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v * amount + y[i] * (1 - amount)))
}

/** Move `color` toward black or white, as little as needed, until it reaches `ratio` against `bg`. */
export function withContrast(color: string, bg: string, ratio: number): string {
  if (contrastRatio(color, bg) >= ratio) return color
  const target = contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff'
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(target, color, t)
    if (contrastRatio(c, bg) >= ratio) return c
  }
  return target
}

export type ThemeVars = Record<string, string>

/**
 * CSS variables for a team theme. `primary` colors the header and highlights;
 * `secondary` (optional) colors buttons and links.
 */
export function teamThemeVars(primary: string, secondary: string | null, dark: boolean): ThemeVars {
  const base = dark ? DARK : LIGHT
  const accentSource = secondary || primary
  // Buttons carry white text in both themes; links sit on the panel.
  const accent = withContrast(accentSource, '#ffffff', 4.5)
  const accentInk = dark ? withContrast(accentSource, base.panel, 4.5) : withContrast(accent, '#ffffff', 5.5)
  const accentSoft = mix(accentSource, base.panel, dark ? 0.22 : 0.14)
  const brandInk = readableInk(primary)
  return {
    '--brand': primary,
    '--brand-ink': brandInk,
    '--brand-muted': withContrast(mix(brandInk, primary, 0.75), primary, 4.5),
    '--brand-chip': mix(brandInk === '#000000' ? '#ffffff' : '#000000', primary, 0.35),
    '--accent': accent,
    '--accent-ink': accentInk,
    '--accent-soft': accentSoft,
    '--accent-soft-ink': withContrast(accentInk, accentSoft, 4.5),
    '--ground': mix(primary, base.ground, dark ? 0.12 : 0.1),
    '--panel-2': mix(primary, base.panel2, dark ? 0.08 : 0.06),
    '--line': mix(primary, dark ? '#2c313a' : '#e2ded5', 0.12),
    '--focus': withContrast(accentSource, base.ground, 3),
  }
}

/** Variables the team theme sets, so they can all be cleared again. */
export const TEAM_THEME_VARS = Object.keys(teamThemeVars('#ff9b25', null, false))
