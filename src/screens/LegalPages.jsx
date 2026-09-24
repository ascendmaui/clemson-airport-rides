import { navigate } from '../lib/navigation'
import { LEGAL_UPDATED, PRIVACY_SECTIONS, TERMS_SECTIONS } from '../../shared/legalCopy.js'

function LegalShell({ title, children }) {
  return (
    <div className="mkt-legal fade-in">
      <div className="mkt-legal-card">
        <button
          type="button"
          className="pressable glass-pill"
          onClick={() => navigate('landing')}
          style={{ fontSize: 18, marginBottom: 16, width: 40, height: 40, borderRadius: 12 }}
        >
          ←
        </button>
        <p className="mkt-kicker">Clemson RIDES</p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4, color: 'var(--purple)', marginBottom: 8 }}>
          {title}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 24 }}>
          Clemson RIDES · Campus airport rides · Last updated {LEGAL_UPDATED}
        </p>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink-secondary)' }}>{children}</div>
        <p style={{ marginTop: 32, fontSize: 13, color: 'var(--ink-tertiary)' }}>
          Questions? Contact support through the in-app Account screen or your Clemson RIDES campus lead.
        </p>
      </div>
    </div>
  )
}

function Section({ heading, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>{heading}</h2>
      {children}
    </section>
  )
}

function LegalBody({ sections }) {
  return sections.map((section) => (
    <Section key={section.heading} heading={section.heading}>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph.slice(0, 48)} style={{ marginBottom: 10 }}>{paragraph}</p>
      ))}
      {section.bullets ? (
        <ul style={{ paddingLeft: 20, margin: 0 }}>
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
