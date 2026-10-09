import { useState } from 'react'
import { navigate } from '../lib/navigation'
import { LEGAL_UPDATED, PRIVACY_SECTIONS, TERMS_SECTIONS } from '../../shared/legalCopy.js'

const AGREED_KEY = 'clemson.legal.agreed'

function LegalShell({ title, children }) {
  const [agreed, setAgreed] = useState(false)
  function agree() {
    try { window.sessionStorage.setItem(AGREED_KEY, LEGAL_UPDATED) } catch { /* private mode */ }
    setAgreed(true)
    navigate('landing')
  }
  return (
    <div className="mkt-legal lux-legal">
      <div className="lux-legal-scroll">
        <button
          type="button"
          className="pressable nav-back-btn lux-legal-back"
          aria-label="Back to landing"
          onClick={() => navigate('landing')}
        >
          Back
        </button>
        <p className="lux-kicker">Clemson RIDES</p>
        <h1>{title}</h1>
        <p className="lux-legal-meta">Last updated {LEGAL_UPDATED}</p>
        <div className="lux-legal-body">{children}</div>
      </div>
      <div className="lux-legal-bar">
        <button type="button" className="pressable lux-agree" onClick={agree}>
          {agreed ? 'Saved' : 'I agree to all'}
        </button>
      </div>
    </div>
  )
}

function Section({ heading, children }) {
  return (
    <section className="lux-legal-section">
      <h2>{heading}</h2>
      {children}
    </section>
  )
}

function LegalBody({ sections }) {
  return sections.map((section) => (
    <Section key={section.heading} heading={section.heading}>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph.slice(0, 48)}>{paragraph}</p>
      ))}
      {section.bullets ? (
        <ul>
          {section.bullets.map((bullet) => <li key={bullet.slice(0, 48)}>{bullet}</li>)}
        </ul>
      ) : null}
    </Section>
  ))
}

export function LegalPrivacy() {
  return (
    <LegalShell title="Privacy Policy">
      <LegalBody sections={PRIVACY_SECTIONS} />
    </LegalShell>
  )
}

export function LegalTerms() {
  return (
    <LegalShell title="Terms of Service">
      <LegalBody sections={TERMS_SECTIONS} />
    </LegalShell>
  )
}
