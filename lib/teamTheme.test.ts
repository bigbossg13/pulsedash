import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contrastRatio, sanitizePrefs } from './settings'
import { mix, teamThemeVars, withContrast } from './teamTheme'

// Bright, dark, pastel, neon and near-gray team colors.
const COLORS = ['#ff9b25', '#ffeb3b', '#00ff00', '#0d47a1', '#c62828', '#6a1b9a', '#000000', '#ffffff',
  '#7f7f7f', '#f8bbd0', '#00bcd4', '#3e2723', '#1de9b6', '#ff1744', '#ffd600', '#2e7d32']

test('every text/background pair in a team theme passes WCAG AA', () => {
  for (const dark of [false, true]) {
    const panel = dark ? '#1a1d23' : '#ffffff'
    for (const primary of COLORS) {
      for (const secondary of [null, '#ffeb3b', '#0d47a1']) {
        const v = teamThemeVars(primary, secondary, dark)
        const label = `${primary}/${secondary}/${dark ? 'dark' : 'light'}`
        assert.ok(contrastRatio(v['--brand-ink'], v['--brand']) >= 4.5, `header text ${label}`)
        assert.ok(contrastRatio(v['--brand-muted'], v['--brand']) >= 4.5, `header small text ${label}`)
        assert.ok(contrastRatio(v['--brand-ink'], v['--brand-chip']) >= 4.5, `field box ${label}`)
        assert.ok(contrastRatio('#ffffff', v['--accent']) >= 4.5, `button text ${label}`)
        assert.ok(contrastRatio(v['--accent-ink'], panel) >= 4.5, `links ${label}`)
        assert.ok(contrastRatio(v['--accent-soft-ink'], v['--accent-soft']) >= 4.5, `tinted rows ${label}`)
        const ink = dark ? '#eceef2' : '#15171c'
        assert.ok(contrastRatio(ink, v['--ground']) >= 4.5, `text on background ${label}`)
        assert.ok(contrastRatio(ink, v['--panel-2']) >= 4.5, `text on tinted panels ${label}`)
      }
    }
  }
})

test('withContrast changes a color only as much as needed', () => {
  assert.equal(withContrast('#0d47a1', '#ffffff', 4.5), '#0d47a1')
  const fixed = withContrast('#ffeb3b', '#ffffff', 4.5)
  assert.ok(contrastRatio(fixed, '#ffffff') >= 4.5)
  assert.ok(contrastRatio(fixed, '#ffffff') < 6, 'not pushed all the way to black')
  assert.equal(mix('#ffffff', '#000000', 0.5), '#808080')
})

test('second color and theme switch are saved and validated', () => {
  const p = sanitizePrefs({ accent2: '#0D47A1', teamTheme: false }, 1)
  assert.equal(p.accent2, '#0d47a1')
  assert.equal(p.teamTheme, false)
  assert.equal(sanitizePrefs({ accent2: 'blue' }, 1).accent2, '')
  assert.equal(sanitizePrefs({}, 1).teamTheme, true)
})
