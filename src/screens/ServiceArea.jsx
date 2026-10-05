import { navigate } from '../lib/navigation'

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
    <div className="lux-area fade-in">
      <header className="lux-area-bar">
        <button type="button" className="pressable" onClick={() => navigate('landing')}>Clemson RIDES</button>
      </header>
      <div className="lux-area-hero">
        <p className="lux-kicker">Service area</p>
        <h1>Outside the service area</h1>
        <p>Clemson RIDES covers campus, downtown, and the airport roads we already serve.</p>
      </div>
      <div className="lux-carousel" aria-label="Service area maps">
        {FRAMES.map((frame) => (
          <figure key={frame.label} className="lux-frame">
            <DarkMap label={frame.label} d={frame.d} />
            <figcaption>{frame.label}</figcaption>
          </figure>
        ))}
      </div>
      <section className="lux-learn" aria-label="Learn more">
        <h2 className="lux-learn-title">Learn More</h2>
        {LEARN.map((card) => (
          <article key={card.title} className="lux-learn-card">
            <h2>{card.title}</h2>
            <p>{card.body}</p>
            <button type="button" className="pressable" onClick={card.action}>{card.label}</button>
          </article>
        ))}
      </section>
    </div>
  )
}
