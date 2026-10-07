import { navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { AIRPORT_SECTION } from '../content/peaceOfMind.js'

const FRAMES = [
  {
    label: 'Campus',
    d: 'M48 62 L118 38 L196 54 L248 92 L232 148 L154 172 L78 150 L42 108 Z',
  },
  {
    label: 'Downtown',
    d: 'M70 48 L150 36 L214 70 L236 128 L188 168 L96 160 L46 118 Z',
  },
  {
    label: 'Airports',
    d: 'M36 88 L92 46 L188 58 L268 96 L250 146 L168 174 L72 152 Z',
  },
]

function DarkMap({ label, d }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={`${label} service boundary`}>
      <rect width="320" height="200" fill="#0a0a0a" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`v${i}`} x1={40 * i} y1="0" x2={40 * i} y2="200" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={40 * i} x2="320" y2={40 * i} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}
      <path d="M20 150 C80 120 140 160 200 130 S280 90 310 110" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <path d="M10 70 C70 90 130 40 190 60 S270 100 320 80" fill="none" stroke="rgba(228,195,154,0.25)" strokeWidth="1" />
      <path d={d} fill="rgba(82,45,128,0.28)" stroke="rgba(244,241,234,0.85)" strokeWidth="1" />
    </svg>
  )
}

const LEARN = [
  {
    title: 'Where we ride',
    body: 'Clemson, downtown, and scheduled trips to Greenville-Spartanburg and Charlotte.',
    action: () => navigate('home'),
    label: 'Book a ride',
  },
  {
    title: 'Game day',
    body: 'When a game day is live, the rider home shows the pickup zone and the fare from the server.',
    action: () => navigate('landing'),
    label: 'See the homepage',
  },
  {
    title: 'Drive',
    body: 'Approved drivers take campus, weekend, and airport trips from the driver app.',
    action: () => navigate('driver-signup'),
    label: 'Apply to drive',
  },
]

export function ServiceArea() {
  return (
    <MarketingChrome current="service-area">
      <div className="mkt-section-head">
        <p className="mkt-kicker">{AIRPORT_SECTION.kicker}</p>
        <h1>{AIRPORT_SECTION.title}</h1>
        <p>{AIRPORT_SECTION.what}</p>
      </div>
      <article className="mkt-card mkt-feature">
        <MarketingPhoto id="airport-on-time" />
        <ol className="mkt-guide">
          {AIRPORT_SECTION.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p><strong>Why it matters. </strong>{AIRPORT_SECTION.why}</p>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('schedule')}>
          Schedule for later
        </button>
      </article>
      <article className="mkt-card mkt-feature">
        <h2>Service area</h2>
        <p>Clemson, downtown, and scheduled trips to Greenville-Spartanburg and Charlotte. If a stop is outside this area, booking says so before you confirm.</p>
      </article>
      <div className="lux-carousel" aria-label="Service area maps">
        {FRAMES.map((frame) => (
          <figure key={frame.label} className="lux-frame">
            <DarkMap label={frame.label} d={frame.d} />
            <figcaption>{frame.label}</figcaption>
          </figure>
        ))}
      </div>
      <section className="mkt-safety-live" aria-label="Learn more">
        {LEARN.map((card) => (
          <article key={card.title} className="mkt-card mkt-feature">
            <h2>{card.title}</h2>
            <p>{card.body}</p>
            <button type="button" className="mkt-text pressable" onClick={card.action}>{card.label}</button>
          </article>
        ))}
      </section>
    </MarketingChrome>
  )
}
