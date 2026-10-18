import type { Metadata, Viewport } from 'next'
import { Atkinson_Hyperlegible, IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from 'next/font/google'
import './globals.css'

// Same type as PulsePoint, plus Atkinson Hyperlegible as the low-vision option.
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' })
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-mono' })
const readable = Atkinson_Hyperlegible({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-readable' })

// PulsePoint's bolt mark in black on a white tile.
const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36' fill='none'%3E%3Crect width='36' height='36' rx='8' fill='%23fff'/%3E%3Cpath d='M24.5 6.74A13 13 0 1 1 11.5 6.74' stroke='%2315171C' stroke-width='2.6' stroke-linecap='round'/%3E%3Cpath d='M20.5 3 11 19h6.5l-2 11.5L25 14.5h-6.5z' fill='%2315171C'/%3E%3C/svg%3E"

export const metadata: Metadata = {
  title: { default: 'PulseDash: FTC pit display', template: '%s · PulseDash' },
  description: 'A live, customizable pit display for FIRST Tech Challenge teams, powered by FTCScout and the FTC Events API.',
  icons: { icon: ICON },
}

export const viewport: Viewport = {
  themeColor: '#ff9b25',
}

// Applies the saved theme, text size, font and motion preference before the
// first paint, so a dark or high-contrast display doesn't flash white.
const prefsScript = `
(function () {
  try {
    var root = document.documentElement;
    var q = new URLSearchParams(location.search);
    if (/\\/view\\/?$/.test(location.pathname)) root.setAttribute('data-page', 'display');
    var team = q.get('demo') ? '90007' : q.get('team') || localStorage.getItem('pulsedash:lastTeam');
    var key = 'pulsedash:prefs:' + (team && /^\\d+$/.test(team) ? team : 'event');
    var p = JSON.parse(localStorage.getItem(key) || '{}');
    if (['light', 'dark', 'contrast'].indexOf(p.theme) >= 0) root.setAttribute('data-theme', p.theme);
    if (['l', 'xl', 'xxl'].indexOf(p.textSize) >= 0) root.setAttribute('data-text', p.textSize);
    if (p.font === 'readable') root.setAttribute('data-font', 'readable');
    if (p.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
    var vars = JSON.parse(localStorage.getItem(key.replace(':prefs:', ':theme:')) || '{}');
    for (var k in vars) if (/^--[a-z0-9-]+$/.test(k) && /^#[0-9a-f]{6}$/.test(vars[k])) root.style.setProperty(k, vars[k]);
  } catch (e) {}
})();
`

export default function PitLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} ${readable.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
