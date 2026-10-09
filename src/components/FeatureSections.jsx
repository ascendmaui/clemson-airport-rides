import { useEffect, useState } from 'react'
import { FEATURES, FEATURES_HEADING, ONLY_AT_CLEMSON_RIDES, featureAnchor } from '../content/features.js'

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

export function FeatureSections() {
  const desktop = useDesktopLayout()
  return (
    <section id="features" className="mkt-feature-section" aria-labelledby="features-heading">
      <div className="mkt-section-head">
        <h2 id="features-heading">{FEATURES_HEADING}</h2>
      </div>
      <div className="mkt-feature-list">
        {FEATURES.map((item) => (
          <article key={item.id} id={featureAnchor(item.id)} className="mkt-card mkt-feature">
            {item.exclusive ? <p className="mkt-kicker">{ONLY_AT_CLEMSON_RIDES}</p> : null}
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
