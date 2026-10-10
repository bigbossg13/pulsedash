import { Suspense } from 'react'
import SetupClient from '@/components/SetupClient'
import { CheckIcon, PulseLogo } from '@/components/icons'

const FEATURES = [
  'Live data from FTCScout and the official FTC Events API',
  'Queue reminders that follow a field running late',
  'Your layout, team color, logo and checklist, saved per team',
  'High contrast, large text, a low-vision font and reduced motion',
  'Made for a pit TV, and still works on a laptop, tablet or phone',
]

export default function SetupPage() {
  return (
    <div className="setup">
      <a className="skip-link" href="#setup">Skip to setup</a>
      <aside className="setup-brand" aria-label="About PulseDash">
        <div className="brand-row">
          <PulseLogo size={40} />
          <div>
            <h1>PulseDash</h1>
            <p>Live pit display for FTC teams</p>
          </div>
        </div>
        <p className="lead">Your next match, when to queue, where you stand and what to expect, on any screen in your pit.</p>
        <ul className="feature-list">
          {FEATURES.map(f => (
            <li key={f}><CheckIcon size={18} />{f}</li>
          ))}
        </ul>
        <div className="suite">
          <h2>Also from Pulse</h2>
          <a href="https://bigbossg13.github.io/pulsepoint/">PulsePoint</a>
          <span>Every FTC team and event on one map.</span>
          <a href="https://bigbossg13.github.io/PulsePit/">PulsePit</a>
          <span>FRC &amp; FTC pit and build resources.</span>
        </div>
        <p className="credits">
          Data from <a href="https://ftcscout.org">FTCScout</a> and the{' '}
          <a href="https://ftc-events.firstinspires.org/services/API">FTC Events API</a>. Not affiliated with <i>FIRST</i>.
        </p>
      </aside>
      <Suspense fallback={<main className="setup-main" id="setup"><p>Loading…</p></main>}>
        <SetupClient />
      </Suspense>
    </div>
  )
}
