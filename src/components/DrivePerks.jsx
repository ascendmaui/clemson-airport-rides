import { navigate } from '../lib/navigation'
import { PAY_TIERS, PERK_GROUPS, COMPARISON_ROWS, COMPARISON_NOTE, COMPARISON_SOURCE_NOTE, TITLE_HIGHLIGHT, RENTAL } from '../content/drivePerks.js'
import '../styles/drivePerks.css'

const PATHS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  flame: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" /></>,
  badge: <><circle cx="12" cy="9" r="5" /><path d="M9 13l-1 8 4-2 4 2-1-8" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M7 15l4-4 3 3 5-6" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  doc: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7M9 8h4" /></>,
  map: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  car: <><path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16" /><rect x="3" y="15" width="18" height="4" rx="1.5" /></>,
  moon: <path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
}

export function Icon({ name, size = 22 }) {
  return (
    <svg className="dp-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}

function OfferPreview() {
  return (
    <div className="dp-offer mkt-card" aria-label="Example offer card">
      <div className="dp-offer-top">
        <div className="dp-avatar" aria-hidden="true">JR</div>
        <div>
          <strong>Jordan R.</strong>
          <span className="dp-rating"><Icon name="star" size={14} /> 4.9</span>
        </div>
        <span className="dp-chip">Purple</span>
      </div>
      <div className="dp-offer-pay">
        <svg className="dp-mini-arc" viewBox="0 0 36 20" aria-hidden="true" focusable="false">
          <path d="M3 18a15 15 0 0 1 30 0" />
          <path className="dp-mini-arc-fill" d="M3 18a15 15 0 0 1 30 0" />
        </svg>
        <div><b>$47</b><span>/hr</span></div>
      </div>
      <p className="dp-offer-meta">Example offer · 38 min · airport run</p>
      <div className="dp-bar" aria-hidden="true"><span style={{ width: '78%' }} /></div>
    </div>
  )
}

export function DrivePerks() {
  return (
    <>
      <section className="dp-hero" aria-labelledby="dp-hero-heading">
        <div className="dp-hero-copy">
          <p className="mkt-kicker">Drive with Clemson RIDES</p>
          <h1 id="dp-hero-heading">Know the pay. Keep the tips. Cash out today.</h1>
          <p className="dp-lede">Every offer shows per-hour pay, the rider’s photo and rating, and a color-coded worth-it gauge. Tips are 100% yours.</p>
          <div className="dp-hero-actions">
            <button type="button" className="dp-btn dp-btn-primary pressable" onClick={() => navigate('driver-signup')}>Apply to drive</button>
            <a className="dp-btn dp-btn-ghost" href="#dp-rental">No car? Rent one</a>
          </div>
        </div>
        <OfferPreview />
      </section>

      <section className="dp-group dp-highlight" aria-labelledby="dp-rebuilt-titles">
        <article className="mkt-card dp-card dp-card-highlight">
          <span className="dp-icon-wrap"><Icon name={TITLE_HIGHLIGHT.icon} /></span>
          <h2 id="dp-rebuilt-titles">{TITLE_HIGHLIGHT.title}</h2>
          <p>{TITLE_HIGHLIGHT.body}</p>
        </article>
      </section>

      {PERK_GROUPS.map((group) => (
        <section key={group.id} className="dp-group" aria-labelledby={`dp-${group.id}`}>
          <h2 id={`dp-${group.id}`}>{group.title}</h2>
          <div className="dp-grid">
            {group.perks.map((perk) => (
              <article key={perk.id} className="mkt-card dp-card">
                <span className="dp-icon-wrap"><Icon name={perk.icon} /></span>
                <h3>{perk.title}</h3>
                <p>{perk.body}</p>
              </article>
            ))}
          </div>
          {group.id === 'see-pay' && <TierLegend />}
        </section>
      ))}

      <section className="dp-group" aria-labelledby="dp-compare">
        <h2 id="dp-compare">Us vs. Uber &amp; Lyft</h2>
        <p className="dp-sub">What you get with Clemson RIDES.</p>
        <div className="mkt-card dp-compare" role="table" aria-label="What you get with Clemson RIDES">
          <div className="dp-compare-row dp-compare-head" role="row">
            <span role="columnheader">Feature</span><span role="columnheader">Clemson RIDES</span>
          </div>
          {COMPARISON_ROWS.map((row) => (
            <div key={row} className="dp-compare-row" role="row">
              <span role="cell">{row}</span>
              <span role="cell" className="dp-yes"><Icon name="check" size={18} /> Yes</span>
            </div>
          ))}
        </div>
        <p className="dp-fine">{COMPARISON_SOURCE_NOTE}</p>
        <p className="dp-fine">{COMPARISON_NOTE}</p>
      </section>
    </>
  )
}

function TierLegend() {
  return (
    <div className="mkt-card dp-legend" aria-label="Worth-it gauge tiers, per-hour pay">
      <h3>Worth-it gauge tiers (per hour)</h3>
      <ul>
        {PAY_TIERS.map((tier) => (
          <li key={tier.id} className={`dp-tier dp-tier-${tier.id}`}>
            <span className="dp-swatch" style={{ '--tier': tier.color }} aria-hidden="true" />
            <span className="dp-tier-name">{tier.label}</span>
            <span className="dp-tier-range">{tier.range}</span>
            <span className="dp-tier-note">{tier.note}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RentalSection() {
  return (
    <section id="dp-rental" className="dp-group" aria-labelledby="dp-rental-heading">
      <div className="mkt-card dp-rental">
        <span className="dp-icon-wrap"><Icon name="key" /></span>
        <h2 id="dp-rental-heading">{RENTAL.title}</h2>
        {RENTAL.body.map((line) => <p key={line}>{line}</p>)}
        <ul className="dp-rental-list">
          {RENTAL.points.map((point) => <li key={point}><Icon name="check" size={16} /> {point}</li>)}
        </ul>
        <div className="dp-grid dp-paths">
          {RENTAL.paths.map((path) => (
            <article key={path.id} className="mkt-card dp-card dp-path">
              <p className="mkt-kicker">{path.kicker}{path.status && <span className="dp-soon">{path.status}</span>}</p>
              <h3>{path.title}</h3>
              <p>{path.body}</p>
              {path.href ? (
                <a className="dp-btn dp-btn-ghost" href={path.href} target="_blank" rel="noopener noreferrer">{path.cta} ↗</a>
              ) : (
                <button type="button" className="dp-btn dp-btn-ghost pressable" onClick={() => navigate('driver-signup', { needs_vehicle: '1' })}>{path.cta}</button>
              )}
              {path.fine && <p className="dp-fine">{path.fine}</p>}
            </article>
          ))}
        </div>
        <button type="button" className="dp-btn dp-btn-primary pressable" onClick={() => navigate('driver-signup', { needs_vehicle: '1' })}>
          {RENTAL.cta}
        </button>
        <p className="dp-fine">{RENTAL.note}</p>
      </div>
    </section>
  )
}
