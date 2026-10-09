import { navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { StatusPill } from '../components/FeatureBlock'
import { AIRPORT_SECTION } from '../content/peaceOfMind.js'

function MapCanvas({ label, children }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={label}>
      <rect width="320" height="200" fill="#0a0a0a" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`v${i}`} x1={40 * i} y1="0" x2={40 * i} y2="200" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={40 * i} x2="320" y2={40 * i} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      {children}
    </svg>
  )
}

function CampusMap() {
  return (
    <MapCanvas label="Campus zone around Memorial Stadium and the core of campus">
      <path d="M24 128 H296" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
      <path d="M168 18 V182" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
      <ellipse cx="86" cy="118" rx="52" ry="34" fill="rgba(245,102,0,0.28)" stroke="#F56600" strokeWidth="2" />
      <ellipse cx="86" cy="118" rx="28" ry="16" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <text x="86" y="168" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="Outfit, sans-serif">Memorial Stadium</text>
      <rect x="186" y="42" width="34" height="26" rx="2" fill="rgba(82,45,128,0.72)" stroke="#fff" />
      <rect x="226" y="42" width="34" height="26" rx="2" fill="rgba(82,45,128,0.72)" stroke="#fff" />
      <rect x="186" y="74" width="34" height="26" rx="2" fill="rgba(82,45,128,0.55)" stroke="#fff" />
      <rect x="226" y="74" width="34" height="26" rx="2" fill="rgba(82,45,128,0.55)" stroke="#fff" />
      <text x="223" y="122" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="Outfit, sans-serif">Campus core</text>
    </MapCanvas>
  )
}

function DowntownMap() {
  return (
    <MapCanvas label="Downtown College Avenue strip">
      <path d="M148 12 H172 V188 H148 Z" fill="rgba(255,255,255,0.16)" />
      {[28, 62, 96, 130, 164].map((y) => (
        <rect key={`l${y}`} x="78" y={y} width="58" height="26" rx="2" fill="rgba(245,102,0,0.35)" stroke="#F56600" />
      ))}
      {[28, 62, 96, 130, 164].map((y) => (
        <rect key={`r${y}`} x="184" y={y} width="58" height="26" rx="2" fill="rgba(82,45,128,0.65)" stroke="#fff" />
      ))}
      <text x="160" y="108" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="Outfit, sans-serif" transform="rotate(-90 160 108)">College Ave</text>
    </MapCanvas>
  )
}

function AirportsMap() {
  return (
    <MapCanvas label="Routes from Clemson to Greenville-Spartanburg and Charlotte">
      <path d="M78 132 C140 110 160 78 196 64" fill="none" stroke="#F56600" strokeWidth="2" />
      <path d="M78 132 C150 90 210 50 268 36" fill="none" stroke="#e4c39a" strokeWidth="2" />
      <circle cx="78" cy="132" r="7" fill="#F56600" stroke="#fff" />
      <text x="78" y="156" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="Outfit, sans-serif">Clemson</text>
      <circle cx="196" cy="64" r="7" fill="#fff" stroke="#F56600" />
      <text x="196" y="50" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="Outfit, sans-serif">GSP</text>
      <circle cx="268" cy="36" r="7" fill="#fff" stroke="#e4c39a" />
      <text x="268" y="22" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="Outfit, sans-serif">CLT</text>
    </MapCanvas>
  )
}

const FRAMES = [
  { label: 'Campus', Map: CampusMap },
  { label: 'Downtown', Map: DowntownMap },
  { label: 'Airports', Map: AirportsMap },
]

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
          {AIRPORT_SECTION.points.map((point) => (
            <li key={point.id}>
              <StatusPill status={point.status} />
              <strong>{point.title}. </strong>
              {point.body}
            </li>
          ))}
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
        {FRAMES.map((frame) => {
          const Map = frame.Map
          return (
            <figure key={frame.label} className="lux-frame">
              <Map />
              <figcaption>{frame.label}</figcaption>
            </figure>
          )
        })}
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
