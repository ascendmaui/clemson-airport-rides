import { useEffect, useState } from 'react'
import { SitePage } from '../components/SitePage'
import { AdCreative } from '../components/AdCreative'
import { navigate } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { buildFieldA11yProps, getFieldErrorProps } from '../lib/formA11y'
import { fetchAdPackages, fetchMyAds, submitAdSignup, uploadAdCreative } from '../lib/adsApi'
import { AD_CATEGORIES, COMING_SOON_COPY } from '../content/adPackages.js'
import { FOUNDING_PACKAGE, UPLOAD_TYPES, signupErrors } from '../../shared/ads/signup.js'
import '../styles/advertise.css'
import '../styles/ads.css'

const EMPTY = {
  businessName: '', contactName: '', email: '', phone: '', category: '', website: '', packageId: FOUNDING_PACKAGE,
  creativeMode: 'build', headline: '', dealText: '', qrUrl: '', theme: 'purple', storagePath: '', contentType: '', website2: '',
}

const money = (c) => (c ? `$${(c / 100).toFixed(c % 100 ? 2 : 0)}` : '')

function Field({ id, label, error, required, children }) {
  return (
    <div className={error ? 'adv-field adv-field--error' : 'adv-field'}>
      <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children}
      {error ? <p {...getFieldErrorProps(id)}>{error}</p> : null}
    </div>
  )
}

const DEFAULT_API = { fetchAdPackages, submitAdSignup, uploadAdCreative }

export function AdsSignupForm({ api = DEFAULT_API }) {
  const [v, setV] = useState(EMPTY)
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
        <p>We review every ad before it plays. You will get payment details by email once your package is confirmed. Sign in with the same email to track it at clemsonrides.com/advertise/my.</p>
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

      <h3>2. Package</h3>
      <Field id="ads-package" label="Package" error={errors.packageId}>
        <select {...a11y('ads-package', 'packageId', false)} name="packageId" value={v.packageId} onChange={set('packageId')}>
          <option value={FOUNDING_PACKAGE}>Founding partner (rates on request)</option>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price_cents ? ` · ${money(p.price_cents)}` : ''}</option>)}
        </select>
      </Field>
      {!packages.length ? <p className="adv-fine">{COMING_SOON_COPY}</p> : null}

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
            <Field id="ads-qr" label="QR link (optional)" error={errors.qrUrl}>
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
        <Field id="ads-file" label="Image or video (16:10 landscape works best, up to 50 MB)" error={errors.storagePath} required>
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
      <p className="adv-fine">Nothing is charged now. Every ad is reviewed before it plays.</p>
    </form>
  )
}

function MyCampaigns() {
  const { user, loading } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!user) return
    fetchMyAds().then(setData).catch((e) => setError(e.message))
  }, [user])
  if (loading) return <p>Loading…</p>
  if (!user) {
    return (
      <div className="mkt-card">
        <p>Sign in with the email you used to sign up to see your campaigns.</p>
        <button type="button" className="dp-btn dp-btn-primary pressable" onClick={() => navigate('sign-in')}>Sign in</button>
      </div>
    )
  }
  if (error) return <p role="alert">{error}</p>
  if (!data) return <p>Loading…</p>
  if (!data.campaigns.length) return <div className="mkt-card"><p>No campaigns for {user.email} yet.</p></div>
  return (
    <div className="ads-panel">
      {data.campaigns.map((c) => (
        <article key={c.id} className="ads-row">
          <h4>{c.name}</h4>
          <p><span className={`ads-chip ads-chip--${c.status}`}>{c.status.replace('_', ' ')}</span></p>
          <p>Shown {c.stats.impressions} times · {Math.round(c.stats.seconds / 60)} min on screen · rides {c.rides_served}{c.rides_purchased ? ` of ${c.rides_purchased}` : ''}</p>
          {c.payment_url && c.status === 'pending_payment' ? <a className="dp-btn dp-btn-primary" href={c.payment_url}>Pay invoice</a> : null}
        </article>
      ))}
    </div>
  )
}

export function AdsSignup({ sub = 'signup' }) {
  const mine = sub === 'my'
  return (
    <SitePage current="advertise">
      <section className="adv-hero mkt-section-head mkt-page-hero">
        <p className="mkt-kicker">Advertise with us</p>
        <h1>{mine ? 'Your campaigns' : 'Build your Clemson Rides ad'}</h1>
        <p className="adv-lede">{mine ? 'Status, time on screen and rides served for your in-car tablet ads.' : 'Pick a package, upload your ad or let us build it, and submit. We review every ad before it plays.'}</p>
      </section>
      <section className="adv-section">{mine ? <MyCampaigns /> : <AdsSignupForm />}</section>
    </SitePage>
  )
}
