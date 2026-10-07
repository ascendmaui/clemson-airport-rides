import { navigate } from '../lib/navigation'
import { SitePage } from '../components/SitePage'
import { FEATURES, ONLY_AT_CLEMSON_RIDES, featureAnchor } from '../content/features.js'
import { RELEASE_NOTE } from '../content/differentiators.js'

const TOP_ID = 'why-top'

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function SectionEnd() {
  return (
    <div className="mkt-section-end">
      <button type="button" className="mkt-why-link pressable" onClick={() => scrollToId(TOP_ID)}>
        Back to top
      </button>
      <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>
        Book a ride
      </button>
    </div>
  )
}

export function WhyClemsonRides() {
  return (
    <SitePage current="why-clemson-rides">
      <section id={TOP_ID} aria-labelledby="why-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Why Clemson Rides</p>
          <h2 id="why-page-heading">Peace of mind</h2>
        </div>
        <div className="mkt-safety-live">
          {FEATURES.map((item) => (
            <a
              key={item.id}
              href={`#${featureAnchor(item.id)}`}
              className="mkt-card mkt-feature mkt-feature-jump"
              onClick={(event) => {
                event.preventDefault()
                scrollToId(featureAnchor(item.id))
              }}
            >
              {item.exclusive ? <p className="mkt-kicker">{ONLY_AT_CLEMSON_RIDES}</p> : null}
              <h3>{item.title}</h3>
              <p>{item.what}</p>
            </a>
          ))}
        </div>
        <p className="mkt-release">{RELEASE_NOTE}</p>
      </section>
      {FEATURES.map((item) => (
        <section
          key={item.id}
          id={featureAnchor(item.id)}
          className="mkt-feature-block"
          aria-labelledby={`${featureAnchor(item.id)}-title`}
        >
          <article className="mkt-card mkt-feature">
            {item.exclusive ? <p className="mkt-kicker">{ONLY_AT_CLEMSON_RIDES}</p> : null}
            <h2 id={`${featureAnchor(item.id)}-title`}>{item.title}</h2>
            <div className="mkt-part">
              <p className="mkt-kicker">What it is</p>
              <p>{item.what}</p>
            </div>
            <div className="mkt-part">
              <p className="mkt-kicker">How it works</p>
              <ol className="mkt-guide">
                {item.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
            <div className="mkt-part">
              <p className="mkt-kicker">Why it matters</p>
              <p>{item.why}</p>
            </div>
            <SectionEnd />
          </article>
        </section>
      ))}
      <section className="mkt-feature-block" aria-label="Keep going">
        <div className="mkt-section-end">
          <button type="button" className="mkt-why-link pressable" onClick={() => scrollToId(TOP_ID)}>
            Back to top
          </button>
          <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>
            Book a ride
          </button>
          <button type="button" className="mkt-why-link pressable" onClick={() => navigate('drive')}>
            Drivers: earn more on scheduled rides
          </button>
        </div>
      </section>
    </SitePage>
  )
}
