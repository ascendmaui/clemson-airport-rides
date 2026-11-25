import { useEffect, useMemo, useRef, useState } from 'react'
import { SitePage } from '../components/SitePage'
import { AdCreative } from '../components/AdCreative'
import { navigate } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { buildFieldA11yProps, getFieldErrorProps } from '../lib/formA11y'
import {
  boostCampaign, fetchAdPackages, fetchMyAds, launchPartnerCampaign, savePartnerCampaign, submitAdSignup,
  submitFoundingApplication, uploadAdCreative, copilotSuggest, copilotImage,
} from '../lib/adsApi'
import {
  AD_CATEGORIES, PRICING_STATUS_COPY, RIDE_BUNDLES, formatDollars, formatPerRide,
} from '../content/adPackages.js'
import { approvedSamples, sampleById } from '../content/sampleAds.js'
import { UPLOAD_TYPES, signupErrors } from '../../shared/ads/signup.js'
import { APPLICATION_HONEYPOT, APPLY_COPY, applicationErrors } from '../../shared/ads/application.js'
import { METRIC_DEFINITIONS, campaignChip, formatEt, ridesCsv } from '../../shared/ads/metrics.js'
import { RADIUS_CHOICES, ROUTE_TYPES, describeTargeting } from '../../shared/ads/targeting.js'
import '../styles/advertise.css'
import '../styles/ads.css'

const DEFAULT_PACKAGE = 'rides-250'
const POLL_MS = 15_000

const EMPTY = {
  businessName: '', contactName: '', email: '', phone: '', category: '', website: '', packageId: DEFAULT_PACKAGE,
  creativeMode: 'build', headline: '', dealText: '', qrUrl: '', theme: 'purple', storagePath: '', contentType: '', website2: '',
}

const money = (c) => (c ? formatDollars(c) : '')

function Field({ id, label, error, required, children, hint }) {
  return (
    <div className={error ? 'adv-field adv-field--error' : 'adv-field'}>
      <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children}
      {hint ? <p className="adv-fine">{hint}</p> : null}
      {error ? <p {...getFieldErrorProps(id)}>{error}</p> : null}
    </div>
  )
}

/** Bundles from the API, or the draft config while the API has none. */
function bundleOptions(packages) {
  const list = (packages || []).filter((p) => p.kind === 'bundle' || (p.active && !p.placeholder))
  if (list.length) return list.map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, rides: p.rides_included, draft: p.draft }))
  return RIDE_BUNDLES.map((b) => ({ id: b.id, name: b.name, priceCents: b.priceCents, rides: b.rides, draft: true }))
}

function PackageOptions({ packages }) {
  return bundleOptions(packages).map((p) => (
    <option key={p.id} value={p.id}>{p.name}{p.priceCents ? ` · ${money(p.priceCents)}` : ''}{p.rides ? ` (${formatPerRide({ rides: p.rides, priceCents: p.priceCents })})` : ''}</option>
  ))
}

const DEFAULT_API = { fetchAdPackages, submitAdSignup, uploadAdCreative }

export function AdsSignupForm({ api = DEFAULT_API, initialPackage = '', template = '' }) {
  const sample = sampleById(template)
  const [v, setV] = useState(() => ({
    ...EMPTY,
    packageId: initialPackage && initialPackage !== 'founding-partner' ? initialPackage : DEFAULT_PACKAGE,
    ...(sample ? { headline: sample.headline, dealText: sample.dealText, theme: sample.theme || 'purple', category: sample.category || '' } : {}),
  }))
  const [errors, setErrors] = useState({})
  const [packages, setPackages] = useState([])
  const [state, setState] = useState('idle')
  const [notice, setNotice] = useState('')
  const [file, setFile] = useState(null)
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))
  const a11y = (id, key, required = true) => buildFieldA11yProps({ id, error: errors[key], required })

  useEffect(() => {
    api.fetchAdPackages().then((d) => setPackages(d.packages || [])).catch(() => setPackages([]))
  }, [api])

  async function onSubmit(e) {
    e.preventDefault()
    let body = { ...v }
    if (v.creativeMode === 'upload' && file) body = { ...body, storagePath: 'pending/00000000-0000-0000-0000-000000000000/x', contentType: file.type }
    const found = signupErrors(body)
    setErrors(found)
    if (Object.keys(found).length) { setNotice('Fix the highlighted fields.'); return }
    setState('sending')
    setNotice('')
    try {
      if (v.creativeMode === 'upload') {
        const up = await api.uploadAdCreative(file)
        body = { ...v, storagePath: up.path, contentType: up.contentType }
      }
      await api.submitAdSignup(body)
      setState('sent')
    } catch (err) {
      setState('idle')
      if (err?.errors) setErrors(err.errors)
      setNotice(err?.message || 'Could not send that. Try again.')
    }
  }

  if (state === 'sent') {
    return (
      <div className="adv-sent mkt-card" role="status">
        <h3>You are in. Your ad is in review.</h3>
        <p>We review every ad before it plays. Nothing is charged until your campaign is approved. Sign in with the same email to track rides and QR scans at clemsonrides.com/advertise/my.</p>
      </div>
    )
  }

  const preview = { kind: 'built', headline: v.headline || v.businessName || 'Your business', dealText: v.dealText || 'Your deal here', qrUrl: v.qrUrl || v.website || '', theme: v.theme }

  return (
    <form className="adv-form mkt-card" onSubmit={onSubmit} noValidate aria-labelledby="ads-signup-heading">
      <h3 id="ads-signup-heading">1. Your business</h3>
      <div className="adv-form-grid">
        <Field id="ads-business" label="Business name" error={errors.businessName} required>
          <input {...a11y('ads-business', 'businessName')} name="businessName" autoComplete="organization" value={v.businessName} onChange={set('businessName')} />
        </Field>
        <Field id="ads-contact" label="Contact name" error={errors.contactName} required>
          <input {...a11y('ads-contact', 'contactName')} name="contactName" autoComplete="name" value={v.contactName} onChange={set('contactName')} />
        </Field>
        <Field id="ads-email" label="Email" error={errors.email} required>
          <input {...a11y('ads-email', 'email')} name="email" type="email" autoComplete="email" value={v.email} onChange={set('email')} />
        </Field>
        <Field id="ads-phone" label="Phone" error={errors.phone} required>
          <input {...a11y('ads-phone', 'phone')} name="phone" type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} />
        </Field>
        <Field id="ads-category" label="Category" error={errors.category}>
          <select {...a11y('ads-category', 'category', false)} name="category" value={v.category} onChange={set('category')}>
            <option value="">Choose one</option>
            {AD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="ads-site" label="Website (optional)" error={errors.website}>
          <input {...a11y('ads-site', 'website', false)} name="websiteUrl" type="url" placeholder="https://" value={v.website} onChange={set('website')} />
        </Field>
      </div>

      <h3>2. Ride bundle</h3>
      <Field id="ads-package" label="How many rides should your ad run in?" error={errors.packageId}>
        <select {...a11y('ads-package', 'packageId', false)} name="packageId" value={v.packageId} onChange={set('packageId')}>
          <PackageOptions packages={packages} />
        </select>
      </Field>
      <p className="adv-fine">{PRICING_STATUS_COPY} Founding partner? <a href="/advertise/apply">{APPLY_COPY}</a>.</p>

      <h3>3. Your ad</h3>
      <div className="ads-mode" role="group" aria-label="How do you want to make your ad?">
        <button type="button" aria-pressed={v.creativeMode === 'build'} onClick={() => setV((p) => ({ ...p, creativeMode: 'build' }))}>Build my ad</button>
        <button type="button" aria-pressed={v.creativeMode === 'upload'} onClick={() => setV((p) => ({ ...p, creativeMode: 'upload' }))}>Upload my own</button>
      </div>
      {v.creativeMode === 'build' ? (
        <div className="ads-grid2">
          <div className="adv-form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <Field id="ads-headline" label="Headline" error={errors.headline} required>
              <input {...a11y('ads-headline', 'headline')} name="headline" maxLength={80} placeholder="Tiger Tacos" value={v.headline} onChange={set('headline')} />
            </Field>
            <Field id="ads-deal" label="Deal text" error={errors.dealText} required>
              <input {...a11y('ads-deal', 'dealText')} name="dealText" maxLength={160} placeholder="15% off before kickoff" value={v.dealText} onChange={set('dealText')} />
            </Field>
            <Field id="ads-qr" label="QR link: where scans should land (optional)" error={errors.qrUrl}>
              <input {...a11y('ads-qr', 'qrUrl', false)} name="qrUrl" type="url" placeholder="https://" value={v.qrUrl} onChange={set('qrUrl')} />
            </Field>
            <Field id="ads-theme" label="Colors">
              <select id="ads-theme" name="theme" value={v.theme} onChange={set('theme')}>
                <option value="purple">Purple</option>
                <option value="orange">Orange</option>
                <option value="light">Light</option>
              </select>
            </Field>
          </div>
          <div className="ads-preview-wrap" aria-label="Ad preview"><AdCreative creative={preview} preview /></div>
        </div>
      ) : (
        <Field id="ads-file" label="Image or video (16:9 landscape works best, up to 50 MB)" error={errors.storagePath} required>
          <input id="ads-file" name="file" type="file" accept={Object.keys(UPLOAD_TYPES).join(',')} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
      )}
      <div className="adv-hp" aria-hidden="true">
        <label htmlFor="ads-website2">Website</label>
        <input id="ads-website2" name="website2" tabIndex={-1} autoComplete="off" value={v.website2} onChange={set('website2')} />
      </div>
      {notice ? <p className="adv-notice" role="alert">{notice}</p> : null}
      <button type="submit" className="dp-btn dp-btn-primary pressable adv-submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Submit for review'}
      </button>
      <p className="adv-fine">Nothing is charged now. Every ad is reviewed before it plays. Every QR code is a tracking link, so you see each scan.</p>
    </form>
  )
}

/* ---------------- Founding-partner application ---------------- */

const APPLY_EMPTY = { businessName: '', category: '', address: '', contactName: '', email: '', phone: '', website: '', promote: '', offer: '', [APPLICATION_HONEYPOT]: '' }
const DEFAULT_APPLY_API = { submitFoundingApplication }

export function FoundingApplicationForm({ api = DEFAULT_APPLY_API }) {
  const [v, setV] = useState(APPLY_EMPTY)
  const [errors, setErrors] = useState({})
  const [state, setState] = useState('idle')
  const [notice, setNotice] = useState('')
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))
  const a11y = (id, key, required = true) => buildFieldA11yProps({ id, error: errors[key], required })

  async function onSubmit(e) {
    e.preventDefault()
    const found = applicationErrors(v)
    setErrors(found)
    if (Object.keys(found).length) { setNotice('Fix the highlighted fields.'); return }
    setState('sending')
    setNotice('')
    try {
      await api.submitFoundingApplication(v)
      setState('sent')
    } catch (err) {
      setState('idle')
      if (err?.errors) setErrors(err.errors)
      setNotice(err?.message || 'Could not send that. Try again.')
    }
  }

  if (state === 'sent') {
    return (
      <div className="adv-sent mkt-card" role="status">
        <h3>Application received.</h3>
        <p>We review every founding-partner application by hand and reply within two business days. Approved partners unlock founding rates.</p>
      </div>
    )
  }

  return (
    <form className="adv-form mkt-card" onSubmit={onSubmit} noValidate aria-labelledby="ads-apply-heading">
      <h3 id="ads-apply-heading">Tell us about your business</h3>
      <div className="adv-form-grid">
        <Field id="apply-business" label="Business name" error={errors.businessName} required>
          <input {...a11y('apply-business', 'businessName')} name="businessName" autoComplete="organization" value={v.businessName} onChange={set('businessName')} />
        </Field>
        <Field id="apply-category" label="Category" error={errors.category} required>
          <select {...a11y('apply-category', 'category')} name="category" value={v.category} onChange={set('category')}>
            <option value="">Choose one</option>
            {AD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="apply-address" label="Business address" error={errors.address} required>
          <input {...a11y('apply-address', 'address')} name="address" autoComplete="street-address" placeholder="123 College Ave, Clemson, SC" value={v.address} onChange={set('address')} />
        </Field>
        <Field id="apply-website" label="Website (optional)" error={errors.website}>
          <input {...a11y('apply-website', 'website', false)} name="website" type="url" placeholder="https://" value={v.website} onChange={set('website')} />
        </Field>
        <Field id="apply-contact" label="Contact name" error={errors.contactName} required>
          <input {...a11y('apply-contact', 'contactName')} name="contactName" autoComplete="name" value={v.contactName} onChange={set('contactName')} />
        </Field>
        <Field id="apply-email" label="Email" error={errors.email} required>
          <input {...a11y('apply-email', 'email')} name="email" type="email" autoComplete="email" value={v.email} onChange={set('email')} />
        </Field>
        <Field id="apply-phone" label="Phone (optional)" error={errors.phone}>
          <input {...a11y('apply-phone', 'phone', false)} name="phone" type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} />
        </Field>
      </div>
      <Field id="apply-promote" label="What would you promote?" error={errors.promote} required>
        <textarea {...a11y('apply-promote', 'promote')} name="promote" rows={3} maxLength={500} placeholder="Game-day happy hour, a new menu, student discount…" value={v.promote} onChange={set('promote')} />
      </Field>
      <Field id="apply-offer" label="Why you, and what offer would riders get? (optional)" error={errors.offer}>
        <textarea {...a11y('apply-offer', 'offer', false)} name="offer" rows={3} maxLength={1000} value={v.offer} onChange={set('offer')} />
      </Field>
      <div className="adv-hp" aria-hidden="true">
        <label htmlFor="apply-hp">Company URL</label>
        <input id="apply-hp" name={APPLICATION_HONEYPOT} tabIndex={-1} autoComplete="off" value={v[APPLICATION_HONEYPOT]} onChange={set(APPLICATION_HONEYPOT)} />
      </div>
      {notice ? <p className="adv-notice" role="alert">{notice}</p> : null}
      <button type="submit" className="dp-btn dp-btn-primary pressable adv-submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Apply'}
      </button>
      <p className="adv-fine">Limited spots. Nothing is charged by applying.</p>
    </form>
  )
}

/* ---------------- Partner analytics ---------------- */

export function MetricCounter({ id, label, value, hint }) {
  const tipId = `metric-tip-${id}`
  return (
    <div className="ads-metric" data-metric={id}>
      <span className="ads-metric-value">{Number(value || 0).toLocaleString('en-US')}</span>
      <span className="ads-metric-label">
        {label}
        <button type="button" className="ads-tip" aria-describedby={tipId} aria-label={`What is ${label}?`} title={METRIC_DEFINITIONS[id]}>?</button>
        <span role="tooltip" id={tipId} className="ads-tip-text">{METRIC_DEFINITIONS[id]}</span>
      </span>
      {hint ? <span className="ads-metric-hint">{hint}</span> : null}
    </div>
  )
}

export function CampaignCounters({ metrics = {} }) {
  return (
    <div className="ads-metrics" aria-live="polite">
      <MetricCounter id="scans" label="QR scans" value={metrics.scans} hint={`${metrics.scanRate || 0}% of rides`} />
      <MetricCounter id="rides" label="Rides" value={metrics.rides} hint={metrics.ridesPurchased ? `of ${metrics.ridesPurchased.toLocaleString('en-US')} purchased` : ''} />
      <MetricCounter id="impressions" label="Impressions" value={metrics.impressions} />
      <MetricCounter id="runs" label="Ad runs" value={metrics.runs} />
    </div>
  )
}

function downloadCsv(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-rides.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function BoostButton({ campaign, api, onDone }) {
  const [quote, setQuote] = useState(null)
  const [msg, setMsg] = useState('')
  const q = campaign.boostQuote
  if (!q?.ok) return null
  if (quote) {
    return (
      <div className="ads-boost" role="dialog" aria-label="Confirm boost">
        <p>Boost adds <strong>{quote.ridesAdded.toLocaleString('en-US')} rides</strong> (doubles what is left) at {Number(quote.perRideCents).toFixed(1)}¢ per ride: <strong>{money(quote.priceCents)}</strong>. Same ad, same targeting.</p>
        <div className="ads-actions">
          <button type="button" className="primary" onClick={async () => {
            try { await api.boostCampaign(campaign.id, true); setMsg('Boost requested. It starts once payment is confirmed.'); setQuote(null); onDone?.() } catch (e) { setMsg(e.message) }
          }}>Confirm boost · {money(quote.priceCents)}</button>
          <button type="button" onClick={() => setQuote(null)}>Cancel</button>
        </div>
      </div>
    )
  }
  return (
    <>
      <button type="button" className="purple" onClick={async () => {
        try { const r = await api.boostCampaign(campaign.id, false); setQuote(r.quote) } catch (e) { setMsg(e.message) }
      }}>Boost: double remaining rides</button>
      {msg ? <p role="status" className="adv-fine">{msg}</p> : null}
    </>
  )
}

function CampaignCard({ c, api, onChange }) {
  const chip = campaignChip(c)
  const m = c.metrics || {}
  const pct = m.ridesPurchased ? Math.min(100, Math.round((m.rides / m.ridesPurchased) * 100)) : 0
  const pendingBoost = (c.boosts || []).find((b) => b.status === 'pending_payment')
  const creative = (c.ad_creatives || [])[0]
  return (
    <article className="ads-row" data-campaign={c.id}>
      <div className="ads-row-head">
        <h4>{c.name}</h4>
        <span className={`ads-chip ads-chip--${chip.id}`}>{chip.label}</span>
      </div>
      <CampaignCounters metrics={m} />
      {m.ridesPurchased ? (
        <div className="ads-progress" role="progressbar" aria-valuemin={0} aria-valuemax={m.ridesPurchased} aria-valuenow={m.rides} aria-label="Rides delivered">
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <p className="adv-fine">Rides delivered {m.rides || 0}{m.ridesPurchased ? ` of ${m.ridesPurchased}` : ''} · Targeting: {describeTargeting(c.targeting)}{c.game_day_boost ? ' · Game-day boost' : ''}</p>
      {(c.creativeRanking || []).length > 1 ? (
        <table className="ads-table">
          <caption>Which ad converts best</caption>
          <thead><tr><th>Ad</th><th>Rides</th><th>QR scans</th><th>Scan rate</th></tr></thead>
          <tbody>{c.creativeRanking.map((r) => <tr key={r.creativeId}><td>{r.headline}</td><td>{r.rides}</td><td>{r.scans}</td><td>{r.scanRate}%</td></tr>)}</tbody>
        </table>
      ) : null}
      {(m.rideList || []).length ? (
        <details>
          <summary>Every ride your ad ran on ({m.rideList.length})</summary>
          <table className="ads-table">
            <thead><tr><th>Ride</th><th>Time</th><th>QR scans</th></tr></thead>
            <tbody>{m.rideList.slice(0, 200).map((r) => <tr key={r.ref}><td>{r.ref}</td><td>{formatEt(r.at)}</td><td>{r.scans}</td></tr>)}</tbody>
          </table>
        </details>
      ) : <p className="adv-fine">Rides appear here as soon as your ad runs during a ride.</p>}
      <div className="ads-actions">
        {(m.rideList || []).length ? <button type="button" onClick={() => downloadCsv(c.name, ridesCsv(c.name, m.rideList))}>Download CSV</button> : null}
        {c.status === 'draft' && creative ? (
          <button type="button" className="primary" onClick={async () => { await api.launchPartnerCampaign(c.id); onChange?.() }}>Launch My Campaign</button>
        ) : null}
        {pendingBoost ? <span className="ads-chip ads-chip--pending_payment">Boost +{pendingBoost.rides_added} rides · pending payment</span> : <BoostButton campaign={c} api={api} onDone={onChange} />}
        {c.payment_url && c.status === 'pending_payment' ? <a className="dp-btn dp-btn-primary" href={c.payment_url}>Pay invoice</a> : null}
      </div>
    </article>
  )
}

const BUILD_EMPTY = {
  packageId: DEFAULT_PACKAGE, creativeMode: 'build', headline: '', dealText: '', theme: 'purple', storagePath: '', contentType: '',
  creativeId: '', destinationUrl: '', radius: 0, routes: ['all'], gameDayBoost: false,
}

/** AI co-pilot: only rendered when the server says ADS_AI_COPILOT_ENABLED is on. */
export function CopilotPanel({ api, copilot, current, onApply }) {
  const [idea, setIdea] = useState('')
  const [suggestion, setSuggestion] = useState(null)
  const [image, setImage] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  if (!copilot?.enabled) return null
  async function ask(instruction = '') {
    setBusy('text'); setMsg('')
    try {
      const out = await api.copilotSuggest({ idea, instruction, previous: suggestion ? current : null })
      setSuggestion(out.suggestion)
    } catch (err) { setMsg(err?.message || 'The co-pilot could not help right now.') } finally { setBusy('') }
  }
  async function makeImage() {
    setBusy('image'); setMsg('')
    try {
      const out = await api.copilotImage({ prompt: idea || current.dealText || current.headline })
      setImage(out)
      onApply({ creativeMode: 'upload', storagePath: out.storagePath, contentType: out.contentType })
      setMsg('Image added. It still needs approval before it can run.')
    } catch (err) { setMsg(err?.message || 'Images are not available yet.') } finally { setBusy('') }
  }
  return (
    <div className="ads-copilot mkt-card" data-testid="ads-copilot">
      <h4>Ad co-pilot</h4>
      <p className="ads-muted">Describe your deal. The co-pilot suggests offers, headlines and colors. Everything still goes to review.</p>
      <label htmlFor="cp-idea">Your idea</label>
      <input id="cp-idea" maxLength={200} placeholder="Wings special before kickoff" value={idea} onChange={(e) => setIdea(e.target.value)} />
      <div className="ads-actions">
        <button type="button" className="dp-btn dp-btn-primary pressable" disabled={!!busy} onClick={() => ask()}>{busy === 'text' ? 'Thinking…' : 'Suggest'}</button>
        {suggestion ? <button type="button" className="dp-btn dp-btn-ghost pressable" disabled={!!busy} onClick={() => ask('make it bolder')}>Make it bolder</button> : null}
        {suggestion ? <button type="button" className="dp-btn dp-btn-ghost pressable" disabled={!!busy} onClick={() => ask('make it shorter')}>Shorter</button> : null}
        {copilot.image ? <button type="button" className="dp-btn dp-btn-ghost pressable" disabled={!!busy} onClick={makeImage}>{busy === 'image' ? 'Drawing…' : 'Make a 16:9 image'}</button> : null}
      </div>
      {suggestion ? (
        <ul className="ads-copilot-list">
          {suggestion.headlines.map((h, i) => (
            <li key={`h${i}`}>
              <strong>{h}</strong>
              <button type="button" className="ads-link" onClick={() => onApply({ headline: h, dealText: suggestion.dealText || suggestion.offers[i] || '', theme: suggestion.theme })}>Use</button>
            </li>
          ))}
          {suggestion.offers.map((o, i) => (
            <li key={`o${i}`}>{o} <button type="button" className="ads-link" onClick={() => onApply({ dealText: o })}>Use as deal</button></li>
          ))}
        </ul>
      ) : null}
      {image ? <p className="ads-muted">Image saved for review: {image.storagePath}</p> : null}
      {msg ? <p role="status">{msg}</p> : null}
    </div>
  )
}

export function CampaignBuilder({ partner, packages = [], creatives = [], api, onSaved, copilot = null }) {
  const [v, setV] = useState(() => ({ ...BUILD_EMPTY, headline: partner?.business_name || '' }))
  const [file, setFile] = useState(null)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))
  const templates = approvedSamples()
  const toggleRoute = (id) => setV((p) => {
    if (id === 'all') return { ...p, routes: ['all'] }
    const next = p.routes.filter((r) => r !== 'all')
    const routes = next.includes(id) ? next.filter((r) => r !== id) : [...next, id]
    return { ...p, routes: routes.length ? routes : ['all'] }
  })

  async function save(launch) {
    setBusy(true)
    setNotice('')
    try {
      let body = { ...v, targeting: { radius_mi: Number(v.radius), routes: v.routes }, launch }
      if (v.creativeMode === 'upload') {
        if (file) {
          const up = await api.uploadAdCreative(file)
          body = { ...body, storagePath: up.path, contentType: up.contentType }
        } else if (!v.storagePath) {
          throw Object.assign(new Error('Pick an image or video.'), { errors: { storagePath: 'Upload an image or video.' } })
        }
      }
      const out = await api.savePartnerCampaign(body)
      setErrors({})
      setNotice(launch
        ? (out.autoApproved ? 'Launched. Your ad is approved and goes live once payment is confirmed.' : 'Launched. Your ad is in review; it goes live once approved and paid.')
        : 'Draft saved.')
      onSaved?.()
    } catch (err) {
      if (err?.errors) setErrors(err.errors)
      setNotice(err?.message || 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const preview = { kind: 'built', headline: v.headline || 'Your business', dealText: v.dealText || 'Your deal here', qrUrl: v.destinationUrl || 'https://clemsonrides.com/advertise', theme: v.theme }
  return (
    <section className="ads-builder mkt-card" aria-labelledby="ads-builder-heading">
      <h3 id="ads-builder-heading">New campaign</h3>

      <div className="ads-step" aria-labelledby="ads-step-build">
        <h4 id="ads-step-build">1. Build My Ad</h4>
        <div className="ads-mode" role="group" aria-label="Your ad">
          <button type="button" aria-pressed={v.creativeMode === 'build'} onClick={() => setV((p) => ({ ...p, creativeMode: 'build' }))}>Use the builder</button>
          <button type="button" aria-pressed={v.creativeMode === 'upload'} onClick={() => setV((p) => ({ ...p, creativeMode: 'upload' }))}>Upload image or video</button>
          {creatives.length ? <button type="button" aria-pressed={v.creativeMode === 'existing'} onClick={() => setV((p) => ({ ...p, creativeMode: 'existing', creativeId: p.creativeId || creatives[0].id }))}>Reuse an ad</button> : null}
        </div>
        <CopilotPanel api={api} copilot={copilot} current={v} onApply={(patch) => setV((p) => ({ ...p, ...patch }))} />
        {v.creativeMode === 'build' ? (
          <div className="ads-grid2">
            <div className="adv-form-grid" style={{ gridTemplateColumns: '1fr' }}>
              {templates.length ? (
                <Field id="b-template" label="Start from a sample">
                  <select id="b-template" onChange={(e) => { const s = templates.find((t) => t.id === e.target.value); if (s) setV((p) => ({ ...p, headline: s.headline, dealText: s.dealText, theme: s.theme || p.theme })) }} defaultValue="">
                    <option value="">Pick a sample</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.label || t.headline}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field id="b-headline" label="Headline" error={errors.headline} required>
                <input id="b-headline" name="headline" maxLength={80} value={v.headline} onChange={set('headline')} />
              </Field>
              <Field id="b-deal" label="Deal text" error={errors.dealText} required>
                <input id="b-deal" name="dealText" maxLength={160} placeholder="2-for-1 wings before kickoff" value={v.dealText} onChange={set('dealText')} />
              </Field>
              <Field id="b-theme" label="Colors">
                <select id="b-theme" value={v.theme} onChange={set('theme')}>
                  <option value="purple">Purple</option>
                  <option value="orange">Orange</option>
                  <option value="light">Light</option>
                </select>
              </Field>
            </div>
            <div className="ads-preview-wrap" aria-label="Ad preview"><AdCreative creative={preview} preview /></div>
          </div>
        ) : v.creativeMode === 'upload' ? (
          <Field id="b-file" label="Image or video (16:9 landscape, up to 50 MB)" error={errors.storagePath} required>
            <input id="b-file" type="file" accept={Object.keys(UPLOAD_TYPES).join(',')} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
        ) : (
          <Field id="b-existing" label="Ad">
            <select id="b-existing" value={v.creativeId} onChange={set('creativeId')}>
              {creatives.map((c) => <option key={c.id} value={c.id}>{c.headline || 'Untitled'} ({c.approval_status.replace('_', ' ')})</option>)}
            </select>
          </Field>
        )}
      </div>

      <div className="ads-step" aria-labelledby="ads-step-create">
        <h4 id="ads-step-create">2. Create My Campaign</h4>
        <div className="adv-form-grid">
          <Field id="b-package" label="Ride bundle" error={errors.packageId} required>
            <select id="b-package" name="packageId" value={v.packageId} onChange={set('packageId')}><PackageOptions packages={packages} /></select>
          </Field>
          <Field id="b-dest" label="Deal link: where QR scans land" error={errors.destinationUrl} hint="Riders scan a Clemson Rides tracking code that logs the scan and forwards here.">
            <input id="b-dest" name="destinationUrl" type="url" placeholder="https://" value={v.destinationUrl} onChange={set('destinationUrl')} />
          </Field>
          <Field id="b-radius" label="Radius around your business">
            <select id="b-radius" value={v.radius} onChange={set('radius')}>
              {RADIUS_CHOICES.map((r) => <option key={r} value={r}>{r ? `Within ${r} mi` : 'Anywhere we drive'}</option>)}
            </select>
          </Field>
        </div>
        <fieldset className="ads-routes">
          <legend>Ride types</legend>
          {ROUTE_TYPES.map((r) => (
            <label key={r.id}><input type="checkbox" checked={v.routes.includes(r.id)} onChange={() => toggleRoute(r.id)} /> {r.label}</label>
          ))}
        </fieldset>
        <label className="ads-check"><input type="checkbox" checked={v.gameDayBoost} onChange={(e) => setV((p) => ({ ...p, gameDayBoost: e.target.checked }))} /> Game-day boost: play more often on home game weekends</label>
      </div>

      <div className="ads-step" aria-labelledby="ads-step-launch">
        <h4 id="ads-step-launch">3. Launch My Campaign</h4>
        <p className="adv-fine">{PRICING_STATUS_COPY} Every ad is reviewed before it plays.</p>
        {notice ? <p className="adv-notice" role="status">{notice}</p> : null}
        <div className="ads-actions">
          <button type="button" disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button type="button" className="primary" disabled={busy} onClick={() => save(true)}>Launch My Campaign</button>
        </div>
      </div>
    </section>
  )
}

const DASH_API = { fetchMyAds, fetchAdPackages, savePartnerCampaign, launchPartnerCampaign, boostCampaign, uploadAdCreative, copilotSuggest, copilotImage }

/** Signed-in partner view. Counters refresh every 15 s (RLS-safe: the API returns only your rows). */
export function PartnerDashboard(props) {
  const { user, loading } = useAuth()
  return <PartnerDashboardView user={user} loading={loading} {...props} />
}

export function PartnerDashboardView({ api = DASH_API, data: initial = null, user, loading = false }) {
  const [data, setData] = useState(initial)
  const [packages, setPackages] = useState([])
  const [error, setError] = useState('')
  const timer = useRef(null)
  const refresh = useMemo(() => () => api.fetchMyAds().then((d) => { setData(d); setError('') }).catch((e) => setError(e.message)), [api])

  useEffect(() => {
    if (!user || initial) return undefined
    refresh()
    api.fetchAdPackages().then((d) => setPackages(d.packages || [])).catch(() => {})
    timer.current = window.setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
    return () => window.clearInterval(timer.current)
  }, [user, initial, api, refresh])

  if (loading) return <p>Loading…</p>
  if (!user) {
    return (
      <div className="mkt-card">
        <p>Sign in with the email you used to sign up to see your rides, impressions and QR scans.</p>
        <button type="button" className="dp-btn dp-btn-primary pressable" onClick={() => navigate('sign-in')}>Sign in</button>
      </div>
    )
  }
  if (error && !data) return <p role="alert">{error}</p>
  if (!data) return <p>Loading…</p>
  const partner = (data.partners || []).find((p) => p.status === 'active') || data.partners?.[0]
  const creatives = (data.campaigns || []).flatMap((c) => c.ad_creatives || [])
  return (
    <div className="ads-panel">
      {data.onboarded ? (
        <CampaignBuilder partner={partner} packages={packages} creatives={creatives} api={api} onSaved={refresh} copilot={data.copilot} />
      ) : (
        <div className="mkt-card ads-onboard" data-testid="ads-onboarding">
          <h3>Finish onboarding to build and launch campaigns</h3>
          <p>{partner ? 'Your partner account is being reviewed. We will email you when it is active.' : `No partner account for ${user.email} yet.`}</p>
          <div className="ads-actions">
            <a className="dp-btn dp-btn-primary pressable" href="/advertise/signup">Sign up</a>
            <a className="dp-btn dp-btn-ghost pressable" href="/advertise/apply">{APPLY_COPY}</a>
          </div>
        </div>
      )}
      {(data.campaigns || []).map((c) => <CampaignCard key={c.id} c={c} api={api} onChange={refresh} />)}
      <p className="adv-fine">Updated {formatEt(data.refreshedAt)}. Counters refresh every 15 seconds.</p>
    </div>
  )
}

export function AdsSignup({ sub = 'signup', params = {} }) {
  const page = sub === 'my' ? 'my' : sub === 'apply' ? 'apply' : 'signup'
  const copy = {
    my: ['Your campaigns', 'Rides your ad ran in, impressions, and every QR scan, live.'],
    apply: [APPLY_COPY, 'Founding partners lock in launch rates. Tell us about your business; we review every application by hand.'],
    signup: ['Build your Clemson Rides ad', 'Pay only for the rides your ad is shown in. Pick a ride bundle, upload your ad or let us build it, and submit for review.'],
  }[page]
  return (
    <SitePage current="advertise">
      <section className="adv-hero mkt-section-head mkt-page-hero">
        <p className="mkt-kicker">Advertise with us</p>
        <h1>{copy[0]}</h1>
        <p className="adv-lede">{copy[1]}</p>
      </section>
      <section className="adv-section">
        {page === 'my' ? <PartnerDashboard /> : page === 'apply' ? <FoundingApplicationForm /> : <AdsSignupForm initialPackage={params.package || ''} template={params.template || ''} />}
      </section>
    </SitePage>
  )
}
