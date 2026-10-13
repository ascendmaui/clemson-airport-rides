import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { partnersApi, uploadRentalFile, usd } from '../lib/rentalPartners.js'
import {
  BODY_STYLES, CONDITION_LEVELS, CONDITION_PHOTO_SLOTS, TITLE_STATUSES, VEHICLE_RULES_COPY, VEHICLE_STANDARD_MIN_YEAR,
} from '../../shared/vehicleStandards.js'
import {
  OFF_PLATFORM_PAYMENT_NOTE, PARTNER_TERMS_DRAFT, evaluateListing, filterListings, partnerSignupErrors,
} from '../../shared/rentalPartner.js'
import { nextStatuses } from '../../shared/rentalStateMachine.js'

const wrap = { maxWidth: 880, margin: '0 auto', padding: '24px 16px 64px' }
const card = {
  background: 'rgba(255, 252, 248, 0.82)',
  border: '1px solid rgba(255, 255, 255, 0.85)',
  borderRadius: 20,
  padding: 18,
  marginBottom: 16,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 28px rgba(82, 45, 128, 0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
}
const label = { display: 'block', fontSize: 13, fontWeight: 600, margin: '10px 0 4px', color: '#2b1d40' }
const input = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cfc6dc', fontSize: 15, boxSizing: 'border-box', background: 'rgba(255,255,255,0.9)' }
const btn = {
  background: '#F56600',
  color: '#141414',
  border: '1px solid rgba(255,255,255,0.55)',
  borderRadius: 999,
  padding: '11px 18px',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: 44,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 8px 18px rgba(245,102,0,0.24)',
}
const btn2 = { ...btn, background: 'rgba(255,252,248,0.86)', color: '#522D80', border: '1px solid rgba(82,45,128,0.35)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }
const errStyle = { color: '#b00020', fontSize: 13, margin: '4px 0 0' }
const pill = (bg, fg) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: bg, color: fg })
const REVIEW_PILL = {
  approved: ['#e3f5e8', '#1d6b34', 'Approved'],
  pending_admin_review: ['#fff4e0', '#8a5300', 'Pending admin review'],
  rejected: ['#fde8ea', '#9b1c2c', 'Rejected'],
}

function Field({ id, text, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} style={label}>{text}</label>
      {children}
      {hint && <p style={{ fontSize: 12, color: '#6b5f7a', margin: '4px 0 0' }}>{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" style={errStyle}>{error}</p>}
    </div>
  )
}

function TextInput({ id, value, onChange, error, ...rest }) {
  return <input id={id} style={{ ...input, borderColor: error ? '#b00020' : '#cfc6dc' }} aria-invalid={error ? 'true' : 'false'}
    aria-describedby={error ? `${id}-err` : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
}

export function VehicleRules({ compact = false }) {
  return (
    <section style={{ ...card, background: '#faf7fd' }} aria-labelledby="vehicle-rules-h">
      <h2 id="vehicle-rules-h" style={{ fontSize: 17, margin: '0 0 8px' }}>Clemson RIDES vehicle standards</h2>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: compact ? 13 : 14, lineHeight: 1.55 }}>
        {VEHICLE_RULES_COPY.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </section>
  )
}

function PaymentNote() {
  return <p role="note" style={{ ...card, background: '#fff8f0', fontSize: 14, margin: '0 0 16px' }}><strong>Payments are off-platform.</strong> {OFF_PLATFORM_PAYMENT_NOTE}</p>
}

/* ---------------- Partner sign-up ---------------- */
export function PartnerJoin({ onDone }) {
  const { user } = useAuth()
  const [f, setF] = useState({ businessName: '', contactName: '', phone: '', email: user?.email || '', city: '', serviceArea: '', agreeTerms: false })
  const [touched, setTouched] = useState(false)
  const [serverErr, setServerErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const errors = touched ? partnerSignupErrors(f) : {}
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(partnerSignupErrors(f)).length) return
    if (!user) { navigate('sign-up', { next: 'partners' }); return }
    setBusy(true); setServerErr(null)
    try {
      await partnersApi('signup', f)
      onDone ? onDone() : navigate('partners')
    } catch (err) { setServerErr(err.message || String(err)) } finally { setBusy(false) }
  }

  return (
    <main style={wrap} data-testid="partner-join">
      <p style={{ color: '#BA4700', fontWeight: 700, margin: 0 }}>Rental Partners</p>
      <h1 style={{ margin: '4px 0 8px' }}>Rent your vehicles to cleared Clemson RIDES drivers</h1>
      <p style={{ color: '#4b3f5c', marginTop: 0 }}>List cars for weekly rental. Only drivers whose license and background check passed can see your listings. New partners are reviewed by our team before listings go live.</p>
      <PaymentNote />
      <VehicleRules />
      <form onSubmit={submit} noValidate style={card} aria-label="Partner sign-up">
        <h2 style={{ fontSize: 17, margin: 0 }}>Your business</h2>
        <Field id="businessName" text="Business name" error={errors.businessName}><TextInput id="businessName" value={f.businessName} onChange={set('businessName')} error={errors.businessName} /></Field>
        <Field id="contactName" text="Contact name" error={errors.contactName}><TextInput id="contactName" value={f.contactName} onChange={set('contactName')} error={errors.contactName} autoComplete="name" /></Field>
        <Field id="phone" text="Phone" error={errors.phone}><TextInput id="phone" value={f.phone} onChange={set('phone')} error={errors.phone} inputMode="tel" autoComplete="tel" /></Field>
        <Field id="email" text="Email" error={errors.email}><TextInput id="email" value={f.email} onChange={set('email')} error={errors.email} type="email" autoComplete="email" /></Field>
        <Field id="city" text="City" error={errors.city}><TextInput id="city" value={f.city} onChange={set('city')} error={errors.city} /></Field>
        <Field id="serviceArea" text="Service area" hint="Where drivers can pick up, e.g. Clemson, Seneca, Greenville" error={errors.serviceArea}><TextInput id="serviceArea" value={f.serviceArea} onChange={set('serviceArea')} error={errors.serviceArea} /></Field>
        <details style={{ marginTop: 14 }} open>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>Partner terms <span style={pill('#fde8ea', '#9b1c2c')}>Draft, needs legal review</span></summary>
          <ol style={{ fontSize: 13, lineHeight: 1.5 }}>{PARTNER_TERMS_DRAFT.map((t) => <li key={t}>{t}</li>)}</ol>
        </details>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, fontSize: 14 }}>
          <input type="checkbox" checked={f.agreeTerms} onChange={(e) => set('agreeTerms')(e.target.checked)} aria-invalid={errors.agreeTerms ? 'true' : 'false'} />
          <span>I agree to the partner terms and will list only vehicles that meet the standards above.</span>
        </label>
        {errors.agreeTerms && <p role="alert" style={errStyle}>{errors.agreeTerms}</p>}
        {serverErr && <p role="alert" style={errStyle}>{serverErr}</p>}
        <div style={{ marginTop: 16 }}><button type="submit" style={btn} disabled={busy}>{user ? (busy ? 'Submitting…' : 'Apply as a partner') : 'Create account to apply'}</button></div>
      </form>
    </main>
  )
}

/* ---------------- Listing form ---------------- */
const EMPTY_LISTING = {
  make: '', model: '', year: '', bodyStyle: 'sedan', seats: 5, vin: '', titleStatus: 'clean', mileage: '',
  condition: 'good', conditionPhotos: {}, inspectionKind: 'attestation', inspectionAttested: false, inspectionDocPath: '',
  registrationExpires: '', insuranceExpires: '', weeklyPrice: '', deposit: '0', mileageLimit: '',
  insuranceIncluded: false, maintenanceIncluded: false, basicsIncluded: false, minDriverAge: 21,
  availableFrom: new Date().toISOString().slice(0, 10), availableUntil: '', pickupLocation: '', photos: [],
  luxuryException: false, luxuryNote: '', luxuryPhotos: [],
}

export function listingToForm(l) {
  return {
    id: l.id, make: l.make, model: l.model, year: String(l.year), bodyStyle: l.body_style, seats: l.seats, vin: l.vin,
    titleStatus: l.title_status, mileage: String(l.mileage), condition: l.condition, conditionPhotos: l.condition_photos || {},
    inspectionKind: l.inspection_kind, inspectionAttested: l.inspection_attested, inspectionDocPath: l.inspection_doc_path || '',
    registrationExpires: l.registration_expires, insuranceExpires: l.insurance_expires,
    weeklyPrice: String(l.weekly_price_cents / 100), deposit: String(l.deposit_cents / 100),
    mileageLimit: l.mileage_limit_weekly == null ? '' : String(l.mileage_limit_weekly),
    insuranceIncluded: l.insurance_included, maintenanceIncluded: l.maintenance_included, basicsIncluded: l.basics_included,
    minDriverAge: l.min_driver_age, availableFrom: l.available_from, availableUntil: l.available_until || '',
    pickupLocation: l.pickup_location, photos: l.photos || [], luxuryException: l.luxury_exception,
    luxuryNote: l.luxury_note || '', luxuryPhotos: l.luxury_photos || [],
  }
}

function UploadButton({ id, text, onFile, accept = 'image/*', bucket, prefix }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  return (
    <span>
      <label htmlFor={id} style={{ ...btn2, display: 'inline-block', padding: '7px 12px', fontSize: 13 }}>{busy ? 'Uploading…' : text}</label>
      <input id={id} type="file" accept={accept} style={{ display: 'none' }} onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return
        setBusy(true); setErr(null)
        try { onFile(await uploadRentalFile(file, { bucket, prefix })) } catch (x) { setErr(x.message) } finally { setBusy(false); e.target.value = '' }
      }} />
      {err && <span role="alert" style={{ ...errStyle, marginLeft: 8 }}>{err}</span>}
    </span>
  )
}

export function ListingForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({ ...EMPTY_LISTING, ...(initial || {}) }))
  const [touched, setTouched] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [serverErr, setServerErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const result = useMemo(() => evaluateListing(f), [f])
  const show = (k) => (submitted || touched[k] ? result.errors[k] : undefined)
  const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v })); setTouched((t) => ({ ...t, [k]: true })) }
  const year = Number(f.year)
  const preFloor = Number.isInteger(year) && String(f.year).length === 4 && year < VEHICLE_STANDARD_MIN_YEAR

  async function save(e) {
    e.preventDefault(); setSubmitted(true); setServerErr(null)
    if (Object.keys(result.errors).length) return
    setBusy(true)
    try { const data = await partnersApi('listing', f); onSaved?.(data.listing) } catch (err) { setServerErr(err.message) } finally { setBusy(false) }
  }

  const outcome = !Object.keys(result.errors).length && result.reviewStatus
  return (
    <form onSubmit={save} noValidate aria-label="Vehicle listing" data-testid="listing-form">
      <VehicleRules compact />
      <div style={card}>
        <h2 style={{ fontSize: 17, margin: 0 }}>Vehicle</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 14px' }}>
          <Field id="make" text="Make" error={show('make')}><TextInput id="make" value={f.make} onChange={set('make')} error={show('make')} /></Field>
          <Field id="model" text="Model" error={show('model')}><TextInput id="model" value={f.model} onChange={set('model')} error={show('model')} /></Field>
          <Field id="year" text="Model year" error={show('year')} hint={`${VEHICLE_STANDARD_MIN_YEAR}+ auto-eligible`}><TextInput id="year" value={f.year} onChange={set('year')} error={show('year')} inputMode="numeric" maxLength={4} /></Field>
          <Field id="bodyStyle" text="Body style" error={show('bodyStyle')}>
            <select id="bodyStyle" style={input} value={f.bodyStyle} onChange={(e) => set('bodyStyle')(e.target.value)}>{BODY_STYLES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
          </Field>
          <Field id="seats" text="Seats (incl. driver)" error={show('seats')}><TextInput id="seats" value={f.seats} onChange={(v) => set('seats')(Number(v) || '')} error={show('seats')} inputMode="numeric" /></Field>
          <Field id="vin" text="VIN" error={show('vin')}><TextInput id="vin" value={f.vin} onChange={set('vin')} error={show('vin')} maxLength={17} style={{ ...input, textTransform: 'uppercase' }} /></Field>
          <Field id="titleStatus" text="Title status" error={show('titleStatus')}>
            <select id="titleStatus" style={input} value={f.titleStatus} onChange={(e) => set('titleStatus')(e.target.value)}>{TITLE_STATUSES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </Field>
          <Field id="mileage" text="Odometer mileage" error={show('mileage')}><TextInput id="mileage" value={f.mileage} onChange={set('mileage')} error={show('mileage')} inputMode="numeric" /></Field>
          <Field id="registrationExpires" text="Registration expires" error={show('registrationExpires')}><TextInput id="registrationExpires" type="date" value={f.registrationExpires} onChange={set('registrationExpires')} error={show('registrationExpires')} /></Field>
          <Field id="insuranceExpires" text="Insurance expires" error={show('insuranceExpires')}><TextInput id="insuranceExpires" type="date" value={f.insuranceExpires} onChange={set('insuranceExpires')} error={show('insuranceExpires')} /></Field>
        </div>
        {preFloor && (
          <div role="status" style={{ ...card, background: '#fff4e0', marginTop: 14 }}>
            <strong>Older than {VEHICLE_STANDARD_MIN_YEAR}.</strong> This vehicle can only be listed as a Luxury exception and stays "pending admin review" until an admin decides.
            <label style={{ display: 'flex', gap: 8, marginTop: 8 }}><input type="checkbox" checked={f.luxuryException} onChange={(e) => set('luxuryException')(e.target.checked)} /> Request a Luxury exception</label>
            {f.luxuryException && (<>
              <Field id="luxuryNote" text="Why it qualifies" error={show('luxuryNote')}><textarea id="luxuryNote" style={{ ...input, minHeight: 70 }} value={f.luxuryNote} onChange={(e) => set('luxuryNote')(e.target.value)} /></Field>
              <p style={{ fontSize: 13, margin: '8px 0 4px' }}>Luxury photos: {f.luxuryPhotos.length}</p>
              <UploadButton id="lux-up" text="Add photo" prefix="luxury" onFile={(u) => set('luxuryPhotos')([...f.luxuryPhotos, u])} />
              {show('luxuryPhotos') && <p role="alert" style={errStyle}>{show('luxuryPhotos')}</p>}
            </>)}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 17, margin: 0 }}>Condition and inspection</h2>
        <Field id="condition" text="Overall condition" error={show('condition')} hint='"Poor" is auto-rejected regardless of year.'>
          <select id="condition" style={input} value={f.condition} onChange={(e) => set('condition')(e.target.value)}>{CONDITION_LEVELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </Field>
        {f.condition === 'poor' && <p role="alert" style={errStyle}>Poor condition is rejected. This listing would be saved as rejected and never shown to drivers.</p>}
        <p style={label}>Condition photos</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {CONDITION_PHOTO_SLOTS.map((s) => (
            <div key={s.id} style={{ border: '1px dashed #cfc6dc', borderRadius: 10, padding: 8, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.label} {f.conditionPhotos[s.id] ? '✓' : ''}</div>
              {f.conditionPhotos[s.id] && <img src={f.conditionPhotos[s.id]} alt={s.label} style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 6 }} />}
              <UploadButton id={`cp-${s.id}`} text={f.conditionPhotos[s.id] ? 'Replace' : 'Upload'} prefix={`cond-${s.id}`} onFile={(u) => set('conditionPhotos')({ ...f.conditionPhotos, [s.id]: u })} />
            </div>
          ))}
        </div>
        {show('conditionPhotos') && <p role="alert" style={errStyle}>{show('conditionPhotos')}</p>}
        <fieldset style={{ border: 0, padding: 0, marginTop: 12 }}>
          <legend style={label}>Inspection pass</legend>
          <label style={{ marginRight: 16 }}><input type="radio" name="insp" checked={f.inspectionKind === 'attestation'} onChange={() => set('inspectionKind')('attestation')} /> Attest</label>
          <label><input type="radio" name="insp" checked={f.inspectionKind === 'upload'} onChange={() => set('inspectionKind')('upload')} /> Upload report</label>
          {f.inspectionKind === 'attestation' && (
            <label style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 14 }}><input type="checkbox" checked={f.inspectionAttested} onChange={(e) => set('inspectionAttested')(e.target.checked)} /> I attest this vehicle passed a safety inspection in the last 12 months.</label>
          )}
          {f.inspectionKind === 'upload' && (
            <div style={{ marginTop: 8 }}><UploadButton id="insp-up" text={f.inspectionDocPath ? 'Replace report' : 'Upload report'} accept="image/*,application/pdf" bucket="rental-docs" prefix="inspection" onFile={set('inspectionDocPath')} /> {f.inspectionDocPath && '✓ uploaded'}</div>
          )}
          {show('inspection') && <p role="alert" style={errStyle}>{show('inspection')}</p>}
        </fieldset>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 17, margin: 0 }}>Rental terms</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 14px' }}>
          <Field id="weeklyPrice" text="Weekly price ($)" error={show('weeklyPrice')}><TextInput id="weeklyPrice" value={f.weeklyPrice} onChange={set('weeklyPrice')} error={show('weeklyPrice')} inputMode="decimal" /></Field>
          <Field id="deposit" text="Deposit ($)" error={show('deposit')}><TextInput id="deposit" value={f.deposit} onChange={set('deposit')} error={show('deposit')} inputMode="decimal" /></Field>
          <Field id="mileageLimit" text="Weekly mileage limit" hint="Blank = unlimited" error={show('mileageLimit')}><TextInput id="mileageLimit" value={f.mileageLimit} onChange={set('mileageLimit')} error={show('mileageLimit')} inputMode="numeric" /></Field>
          <Field id="minDriverAge" text="Minimum driver age" error={show('minDriverAge')}><TextInput id="minDriverAge" value={f.minDriverAge} onChange={(v) => set('minDriverAge')(Number(v) || '')} error={show('minDriverAge')} inputMode="numeric" /></Field>
          <Field id="availableFrom" text="Available from" error={show('availableFrom')}><TextInput id="availableFrom" type="date" value={f.availableFrom} onChange={set('availableFrom')} error={show('availableFrom')} /></Field>
          <Field id="availableUntil" text="Available until (optional)" error={show('availableUntil')}><TextInput id="availableUntil" type="date" value={f.availableUntil} onChange={set('availableUntil')} error={show('availableUntil')} /></Field>
        </div>
        <Field id="pickupLocation" text="Pickup location" error={show('pickupLocation')}><TextInput id="pickupLocation" value={f.pickupLocation} onChange={set('pickupLocation')} error={show('pickupLocation')} placeholder="e.g. 123 College Ave, Clemson" /></Field>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 14 }}>
          <label><input type="checkbox" checked={f.insuranceIncluded} onChange={(e) => set('insuranceIncluded')(e.target.checked)} /> Insurance included</label>
          <label><input type="checkbox" checked={f.maintenanceIncluded} onChange={(e) => set('maintenanceIncluded')(e.target.checked)} /> Maintenance included</label>
          <label><input type="checkbox" checked={f.basicsIncluded} onChange={(e) => set('basicsIncluded')(e.target.checked)} /> Basics included (phone mount, charger, cleaning)</label>
        </div>
        <p style={label}>Listing photos ({f.photos.length})</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {f.photos.map((p) => <img key={p} src={p} alt="Vehicle" style={{ width: 90, height: 64, objectFit: 'cover', borderRadius: 8 }} />)}
          <UploadButton id="photo-up" text="Add photo" onFile={(u) => set('photos')([...f.photos, u])} />
        </div>
        {show('photos') && <p role="alert" style={errStyle}>{show('photos')}</p>}
      </div>
      {outcome && <p role="status" style={{ fontSize: 14 }}>On save: <span style={pill(...REVIEW_PILL[outcome].slice(0, 2))}>{REVIEW_PILL[outcome][2]}</span> {result.reasons.join(' ')}</p>}
      {submitted && Object.keys(result.errors).length > 0 && <p role="alert" style={errStyle}>Fix the {Object.keys(result.errors).length} highlighted field(s).</p>}
      {serverErr && <p role="alert" style={errStyle}>{serverErr}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" style={btn} disabled={busy}>{busy ? 'Saving…' : f.id ? 'Save changes' : 'Create listing'}</button>
        {onCancel && <button type="button" style={btn2} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

/* ---------------- Partner dashboard ---------------- */
export function PartnerDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = () => partnersApi('me').then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  if (error) return <main style={wrap}><p role="alert" style={errStyle}>{error}</p></main>
  if (!data) return <main style={wrap}><p>Loading…</p></main>
  if (!data.partner) return <PartnerJoin onDone={load} />
  const { partner, listings, requests } = data

  async function act(fn) { setMsg(null); try { await fn(); await load() } catch (e) { setMsg(e.message) } }

  return (
    <main style={wrap} data-testid="partner-dashboard">
      <p style={{ color: '#F56600', fontWeight: 700, margin: 0 }}>Rental Partner</p>
      <h1 style={{ margin: '4px 0 6px' }}>{partner.business_name}</h1>
      <p style={{ margin: '0 0 14px', color: '#4b3f5c' }}>{partner.city} · {partner.service_area} · <span style={partner.status === 'approved' ? pill('#e3f5e8', '#1d6b34') : pill('#fff4e0', '#8a5300')}>{partner.status === 'approved' ? 'Approved' : partner.status === 'pending' ? 'Pending admin approval' : partner.status}</span></p>
      <PaymentNote />
      {msg && <p role="alert" style={errStyle}>{msg}</p>}
      {partner.status !== 'approved' && <p style={card}>Thanks for applying. You can add vehicles once an admin approves your account. We will email {partner.email}.</p>}
      {partner.status === 'approved' && (editing ? (
        <ListingForm initial={editing === 'new' ? null : listingToForm(editing)} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      ) : (<>
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 17, margin: 0 }}>Interested drivers</h2>
          </div>
          {!requests.length && <p style={{ color: '#6b5f7a' }}>No requests yet.</p>}
          {requests.map((r) => (
            <div key={r.id} style={{ borderTop: '1px solid #eee', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong>{r.driver.name}</strong> {r.driver.rating ? `★ ${r.driver.rating.toFixed(2)} (${r.driver.ratingCount})` : '· New driver'} · <span style={{ fontSize: 13 }}>{r.driver.checkStatus}</span>
                <div style={{ fontSize: 13, color: '#4b3f5c' }}>{r.vehicle} · <span style={pill('#eef', '#335')}>{r.status}</span>{r.start_date ? ` · ${r.start_date}${r.end_date ? ` → ${r.end_date}` : ''}` : ''}</div>
                {r.message && <div style={{ fontSize: 13 }}>“{r.message}”</div>}
                <div style={{ fontSize: 13 }}>{r.driver.phone ? `📞 ${r.driver.phone} · ✉️ ${r.driver.email}` : 'Contact details appear after you accept.'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {nextStatuses(r.status, 'partner').map((to) => (
                  <button key={to} type="button" style={to === 'declined' || to === 'canceled' ? btn2 : btn}
                    onClick={() => act(() => partnersApi('transition', { requestId: r.id, to }))}>
                    {{ accepted: 'Accept', declined: 'Decline', active: 'Mark active', ended: 'End rental', canceled: 'Cancel' }[to]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 17, margin: 0 }}>Your listings</h2>
            <button type="button" style={btn} onClick={() => setEditing('new')}>Add vehicle</button>
          </div>
          {!listings.length && <p style={{ color: '#6b5f7a' }}>No vehicles yet.</p>}
          {listings.map((l) => {
            const [bg, fg, txt] = REVIEW_PILL[l.review_status] || REVIEW_PILL.pending_admin_review
            return (
              <div key={l.id} style={{ borderTop: '1px solid #eee', padding: '10px 0', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {l.photos?.[0] && <img src={l.photos[0]} alt="" style={{ width: 84, height: 60, objectFit: 'cover', borderRadius: 8 }} />}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong>{l.year} {l.make} {l.model}</strong> · {usd(l.weekly_price_cents)}/wk
                  <div style={{ fontSize: 13 }}><span style={pill(bg, fg)}>{txt}</span> <span style={pill(l.status === 'active' ? '#e3f5e8' : '#eee', '#333')}>{l.status === 'active' ? 'Active' : 'Paused'}</span>{l.review_note ? ` · ${l.review_note}` : ''}</div>
                </div>
                <button type="button" style={btn2} onClick={() => setEditing(l)}>Edit</button>
                <button type="button" style={btn2} onClick={() => act(() => partnersApi('listing-status', { id: l.id, status: l.status === 'active' ? 'paused' : 'active' }))}>{l.status === 'active' ? 'Pause' : 'Unpause'}</button>
              </div>
            )
          })}
        </section>
      </>))}
    </main>
  )
}

/* ---------------- Driver browse ---------------- */
export function DriverRentals() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [flt, setFlt] = useState({ maxWeekly: '', insurance: false, maintenance: false, basics: false, minSeats: '' })
  const [msg, setMsg] = useState(null)
  const load = () => partnersApi('browse').then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const rows = useMemo(() => filterListings(data?.listings, flt), [data, flt])
  const reqFor = (id) => (data?.requests || []).find((r) => r.listing_id === id && ['requested', 'accepted', 'active'].includes(r.status))

  return (
    <main style={wrap} data-testid="driver-rentals">
      <p style={{ color: '#BA4700', fontWeight: 700, margin: 0 }}>No car? Rent one</p>
      <h1 style={{ margin: '4px 0 8px' }}>Weekly rentals from local partners</h1>
      <PaymentNote />
      {error && <p role="alert" style={errStyle}>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && !data.eligible && (
        <section style={card}><p style={{ margin: 0 }}>{data.reason}</p>
          <button type="button" style={{ ...btn, marginTop: 12 }} onClick={() => navigate('driver-onboarding')}>Finish onboarding</button></section>
      )}
      {data?.eligible && (<>
        <section style={{ ...card, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }} aria-label="Filters">
          <div><label htmlFor="maxWeekly" style={label}>Max $/week</label><input id="maxWeekly" style={{ ...input, width: 120 }} inputMode="numeric" value={flt.maxWeekly} onChange={(e) => setFlt({ ...flt, maxWeekly: e.target.value })} /></div>
          <div><label htmlFor="minSeats" style={label}>Min seats</label><input id="minSeats" style={{ ...input, width: 90 }} inputMode="numeric" value={flt.minSeats} onChange={(e) => setFlt({ ...flt, minSeats: e.target.value })} /></div>
          {[['insurance', 'Insurance included'], ['maintenance', 'Maintenance included'], ['basics', 'Basics included']].map(([k, t]) => (
            <label key={k} style={{ fontSize: 14, paddingBottom: 10 }}><input type="checkbox" checked={flt[k]} onChange={(e) => setFlt({ ...flt, [k]: e.target.checked })} /> {t}</label>
          ))}
        </section>
        {msg && <p role="status">{msg}</p>}
        {!rows.length && <p style={{ color: '#6b5f7a' }}>No rentals match right now.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {rows.map((l) => {
            const open = reqFor(l.id)
            return (
              <article key={l.id} style={{ ...card, marginBottom: 0 }}>
                {l.photos?.[0] && <img src={l.photos[0]} alt={`${l.year} ${l.make} ${l.model}`} style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 10 }} />}
                <h3 style={{ margin: '10px 0 2px' }}>{l.year} {l.make} {l.model}</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#4b3f5c' }}>{l.rental_partners?.business_name} · {l.pickup_location}</p>
                <p style={{ margin: '8px 0', fontSize: 15 }}><strong>{usd(l.weekly_price_cents)}/wk</strong> · {usd(l.deposit_cents)} deposit · {l.seats} seats</p>
                <p style={{ margin: 0, fontSize: 13 }}>{l.mileage_limit_weekly ? `${l.mileage_limit_weekly} mi/wk` : 'Unlimited miles'} · Age {l.min_driver_age}+ · from {l.available_from}</p>
                <p style={{ margin: '6px 0', fontSize: 13 }}>{[l.insurance_included && 'Insurance', l.maintenance_included && 'Maintenance', l.basics_included && 'Basics'].filter(Boolean).join(' · ') || 'No extras included'}</p>
                {open ? <p style={pill('#eef', '#335')}>Request {open.status}</p> : (
                  <button type="button" style={btn} onClick={async () => {
                    setMsg(null)
                    try { await partnersApi('interest', { listingId: l.id }); setMsg('Sent. The partner will review your request and contact you if they accept.'); load() } catch (e) { setMsg(e.message) }
                  }}>I'm interested</button>
                )}
              </article>
            )
          })}
        </div>
      </>)}
    </main>
  )
}

/* ---------------- Admin panel ---------------- */
export function AdminRentalPartners() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = () => partnersApi('admin-queue').then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  async function decide(action, id, decision) {
    const note = decision === 'reject' ? window.prompt('Reason (sent to the partner):') || '' : ''
    try { await partnersApi(action, { id, decision, note }); load() } catch (e) { setError(e.message) }
  }
  if (error) return <p role="alert" style={errStyle}>{error}</p>
  if (!data) return <p>Loading…</p>
  return (
    <div data-testid="admin-rental-partners">
      <h2 style={{ fontSize: 18 }}>Rental partners</h2>
      {!data.partners.length && <p>No partner applications.</p>}
      {data.partners.map((p) => (
        <div key={p.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div><strong>{p.business_name}</strong> · {p.contact_name} · {p.phone} · {p.email}<div style={{ fontSize: 13 }}>{p.city} · {p.service_area} · <b>{p.status}</b></div></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {p.status !== 'approved' && <button type="button" style={btn} onClick={() => decide('admin-partner', p.id, 'approve')}>Approve</button>}
            {p.status === 'pending' && <button type="button" style={btn2} onClick={() => decide('admin-partner', p.id, 'reject')}>Reject</button>}
            {p.status === 'approved' && <button type="button" style={btn2} onClick={() => decide('admin-partner', p.id, 'suspend')}>Suspend</button>}
          </div>
        </div>
      ))}
      <h2 style={{ fontSize: 18 }}>Listings</h2>
      {data.listings.map((l) => (
        <div key={l.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>{l.year} {l.make} {l.model}</strong> · {l.rental_partners?.business_name} · VIN {l.vin} · {l.title_status} title · {l.mileage} mi · condition {l.condition}
            <div style={{ fontSize: 13 }}>{(REVIEW_PILL[l.review_status] || [])[2]}{l.luxury_exception ? ` · Luxury exception: ${l.luxury_note}` : ''}{l.review_note ? ` · ${l.review_note}` : ''}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {[...Object.values(l.condition_photos || {}), ...(l.luxury_photos || [])].map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 4 }} /></a>)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {l.review_status !== 'approved' && l.condition !== 'poor' && l.title_status !== 'salvage' && <button type="button" style={btn} onClick={() => decide('admin-listing', l.id, 'approve')}>Approve</button>}
            {l.review_status !== 'rejected' && <button type="button" style={btn2} onClick={() => decide('admin-listing', l.id, 'reject')}>Reject</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
