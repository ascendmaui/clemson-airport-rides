import { useEffect, useState } from 'react'
import { GlassGlyph } from './GlassGlyph'
import { FEATURES, FEATURES_HEADING, ONLY_AT_CLEMSON_RIDES, featureAnchor } from '../content/features.js'
import { navigate } from '../lib/navigation'
import { SiteIcon } from './SiteIcon'

/** The homepage shows six short cards; the Why page carries the full list. */
export const HOME_FEATURE_IDS = Object.freeze(['backup-driver', 'confirm', 'switch-cancel', 'carpool', 'safety', 'airports'])

function CompactFeatures({ ids }) {
  const items = ids.map((id) => FEATURES.find((item) => item.id === id)).filter(Boolean)
  return (
    <section id="features" className="mkt-feature-section site-features-compact" aria-labelledby="features-heading">
      <div className="mkt-section-head site-head-row">
        <h2 id="features-heading">{FEATURES_HEADING}</h2>
        <button type="button" className="pressable site-see-all" onClick={() => navigate('why-clemson-rides')}>
          <span>See all {FEATURES.length} features</span>
          <SiteIcon name="arrow-right" size={16} />
        </button>
      </div>
      <div className="site-feature-grid">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            id={featureAnchor(item.id)}
            className="pressable mkt-card site-feature-card"
            onClick={() => navigate('why-clemson-rides')}
          >
            <GlassGlyph name={item.id} />
            <span className="site-feature-text">
              <span className="site-feature-title">{item.title}</span>
              <span className="site-feature-what">{item.what}</span>
            </span>
            <SiteIcon name="chevron-right" size={18} className="site-feature-chevron" />
          </button>
        ))}
      </div>
    </section>
  )
}

const DESKTOP_QUERY = '(min-width: 960px)'

function useDesktopLayout() {
  const [desktop, setDesktop] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  ))
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY)
    const apply = () => setDesktop(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
  return desktop
}

function Steps({ steps }) {
  return (
    <ol className="mkt-guide">
      {steps.map((step) => <li key={step}>{step}</li>)}
    </ol>
  )
}

function HowItWorks({ steps, desktop }) {
  if (desktop) {
    return (
      <div className="mkt-part">
        <p className="mkt-kicker">How it works</p>
        <Steps steps={steps} />
      </div>
    )
  }
  return (
    <details className="mkt-how">
      <summary>How it works</summary>
      <Steps steps={steps} />
    </details>
  )
}

export function FeatureSections({ compact = false }) {
  const desktop = useDesktopLayout()
  if (compact) return <CompactFeatures ids={HOME_FEATURE_IDS} />
  return (
    <section id="features" className="mkt-feature-section" aria-labelledby="features-heading">
      <div className="mkt-section-head">
        <h2 id="features-heading">{FEATURES_HEADING}</h2>
      </div>
      <div className="mkt-feature-list">
        {FEATURES.map((item) => (
          <article key={item.id} id={featureAnchor(item.id)} className="mkt-card mkt-feature">
            {item.exclusive ? <p className="mkt-kicker">{ONLY_AT_CLEMSON_RIDES}</p> : null}
            <GlassGlyph name={item.id} />
            <h3>{item.title}</h3>
            <div className="mkt-part">
              <p className="mkt-kicker">What it is</p>
              <p>{item.what}</p>
            </div>
            <HowItWorks steps={item.steps} desktop={desktop} />
            <div className="mkt-part">
              <p className="mkt-kicker">Why it matters</p>
              <p>{item.why}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
