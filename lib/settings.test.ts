import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PREFS, parseHex, contrastRatio, decodePrefs, defaultPrefs, encodePrefs, readableInk, sanitizePrefs } from './settings'
import { formatDuration, currentSeason } from './time'

test('sanitizePrefs rejects unsafe or malformed values', () => {
  const p = sanitizePrefs({
    theme: 'neon',
    accent: 'red; background: url(x)',
    logo: 'javascript:alert(1)',
    proxy: 'http://evil.example',
    refresh: 1,
    queueMinutes: 500,
    columns: [['rankings', 'bogus', 'rankings'], [], ['next-match'], ['team-status'], ['upcoming']],
    watch: [1, 1, -4, 2.5, 'x', 99999],
    message: 'Hello\u0007 world',
  }, 123)
  assert.equal(p.theme, 'auto')
  assert.equal(p.accent, '')
  assert.equal(p.logo, '')
  assert.equal(p.proxy, '')
  assert.equal(p.refresh, 15)
  assert.equal(p.queueMinutes, 60)
  assert.deepEqual(p.columns, [['rankings'], ['next-match']])
  assert.deepEqual(p.watch, [1, 99999])
  assert.equal(p.message, 'Hello  world')
})

test('text fields keep spaces while typing; only the message keeps line breaks', () => {
  const p = sanitizePrefs({ displayName: 'Robo ', message: 'Hi!\nWelcome', checklist: ['  Battery  ', '', 'Bumpers\n'] }, 1)
  assert.equal(p.displayName, 'Robo ')
  assert.equal(p.message, 'Hi!\nWelcome')
  assert.deepEqual(p.checklist, ['Battery', 'Bumpers'])
})

test('sanitizePrefs keeps valid values', () => {
  const p = sanitizePrefs({ accent: '#1E88E5', logo: 'https://example.org/logo.png', proxy: 'https://proxy.example.dev', theme: 'contrast', textSize: 'xl' }, 1)
  assert.equal(p.accent, '#1e88e5')
  assert.equal(p.logo, 'https://example.org/logo.png')
  assert.equal(p.proxy, 'https://proxy.example.dev')
  assert.equal(p.theme, 'contrast')
  assert.equal(p.textSize, 'xl')
})

test('without a team, the default layout shows the whole event', () => {
  assert.deepEqual(defaultPrefs(null).columns, [['upcoming', 'alliances'], ['rankings']])
  assert.deepEqual(defaultPrefs(5).columns, DEFAULT_PREFS.columns)
})

test('share links round-trip and leave out uploaded logos', () => {
  const prefs = sanitizePrefs({ ...DEFAULT_PREFS, theme: 'dark', message: 'Ask us about our arm! ✨', watch: [5, 6], logo: 'data:image/png;base64,AAAA' }, 7)
  const encoded = encodePrefs(prefs, 7)
  assert.match(encoded, /^[A-Za-z0-9_-]+$/)
  const back = decodePrefs(encoded, 7)!
  assert.equal(back.theme, 'dark')
  assert.equal(back.message, 'Ask us about our arm! ✨')
  assert.deepEqual(back.watch, [5, 6])
  assert.equal(back.logo, '')
  assert.equal(decodePrefs('%%%not-base64', 7), null)
})

test('team color ink keeps WCAG AA contrast', () => {
  for (const bg of ['#ff9b25', '#ffeb3b', '#0d47a1', '#c62828', '#2e7d32', '#000000', '#ffffff', '#7b3fe4', '#767676', '#8a5a9c', '#3a9d8f', '#e05a00']) {
    assert.ok(contrastRatio(bg, readableInk(bg)) >= 4.5, `${bg} -> ${readableInk(bg)}`)
  }
})

test('durations and seasons', () => {
  assert.equal(formatDuration(45_000), '45 s')
  assert.equal(formatDuration(12 * 60_000), '12 min')
  assert.equal(formatDuration(65 * 60_000), '1 h 5 min')
  assert.equal(currentSeason(new Date(Date.UTC(2026, 9, 10))), 2026)
  assert.equal(currentSeason(new Date(Date.UTC(2027, 2, 1))), 2026)
})

test('the Nexus API key never leaves the device in a share link', () => {
  const prefs = sanitizePrefs({ ...DEFAULT_PREFS, nexusKey: 'secret-key', nexusEvent: '2026USXXQ1' }, 7)
  assert.equal(prefs.nexusEvent, '2026usxxq1')
  const back = decodePrefs(encodePrefs(prefs, 7), 7)!
  assert.equal(back.nexusKey, '')
  assert.equal(back.nexusEvent, '2026usxxq1')
  assert.equal(sanitizePrefs({ nexusKey: 'bad key<script>' }, 7).nexusKey, '')
})

test('hex codes from the color field', () => {
  assert.equal(parseHex('#1E88E5'), '#1e88e5')
  assert.equal(parseHex('1e88e5'), '#1e88e5')
  assert.equal(parseHex(' #18E '), '#1188ee')
  assert.equal(parseHex('#12345'), null)
  assert.equal(parseHex('red'), null)
})
