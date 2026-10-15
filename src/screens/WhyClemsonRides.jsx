import { navigate } from '../lib/navigation'
import { SitePage } from '../components/SitePage'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { GlassGlyph } from '../components/GlassGlyph'
import { SiteIcon } from '../components/SiteIcon'
import { FEATURES, ONLY_AT_CLEMSON_RIDES } from '../content/features.js'

const WHY_IDS = ['backup-driver', 'confirm', 'switch-cancel', 'boosts', 'student', 'tiger-pass', 'clemson']

/** One photo per card so the grid reads evenly. Built for Clemson spans the row. */
const WHY_PHOTOS = {
  'backup-driver': 'airport-on-time',
  confirm: 'safety-verified-driver',
  'switch-cancel': 'campus-phone',
  boosts: 'college-ave-request',
  student: 'day-from-campus',
  'tiger-pass': 'library-study-group',
  clemson: 'gameday-crowd',
}

const CARD_SIZES = '(min-width: 1200px) 380px, (min-width: 760px) 45vw, 92vw'
const SPAN_SIZES = '(min-width: 1200px) 600px, 92vw'

function WhyCard({ feature, photoId }) {
  const span = feature.id === 'clemson'
  return (
    <article className={`mkt-card mkt-feature site-photo-card${span ? ' mkt-why-span' : ''}`}>
      {photoId ? <MarketingPhoto id={photoId} sizes={span ? SPAN_SIZES : CARD_SIZES} /> : null}
      <div className="site-photo-card-body">
        <div className="site-card-top">
          <GlassGlyph name={feature.id} />
          {feature.exclusive ? <p className="mkt-kicker site-badge">{ONLY_AT_CLEMSON_RIDES}</p> : null}
        </div>
        <h3>{feature.title}</h3>
        <p>{feature.what}</p>
        <p className="site-why-matters"><strong>Why it matters. </strong>{feature.why}</p>
      </div>
    </article>
  )
}

export function WhyClemsonRides() {
  const byId = new Map(FEATURES.map((item) => [item.id, item]))
  const features = WHY_IDS.map((id) => byId.get(id))
  return (
    <SitePage current="why-clemson-rides">
      <div className="mkt-section-head mkt-page-hero">
        <p className="mkt-kicker">Why Clemson Rides</p>
        <h1 id="why-page-heading">Peace of mind</h1>
        <p className="mkt-why-intro">
          A generic rideshare sends the open car. Here, a scheduled ride can add a backup driver.
          The driver confirms before they come. You can switch or cancel before they start toward you.
          A boost goes to the driver.
        </p>
        <div className="site-hero-actions">
          <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>
            <span>Book a ride</span>
            <SiteIcon name="arrow-right" size={18} />
          </button>
        </div>
      </div>
      <section className="mkt-why" aria-labelledby="why-page-heading">
        <div className="mkt-safety-live site-card-grid">
          {features.map((feature) => (
            <WhyCard key={feature.id} feature={feature} photoId={WHY_PHOTOS[feature.id]} />
          ))}
        </div>
        <div className="mkt-section-end site-section-end">
          <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>
            <span>Book a ride</span>
            <SiteIcon name="arrow-right" size={18} />
          </button>
        </div>
      </section>
    </SitePage>
  )
}
