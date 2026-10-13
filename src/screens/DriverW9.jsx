import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { navigate } from '../lib/navigation'
import { TAX_CLASSIFICATIONS } from '../../shared/driverOnboarding.js'
import { w9FormIssue, w9StatusLabel } from '../../shared/driverW9.js'
import { loadDriverW9, saveDriverW9Record } from '../../packages/rides-native/driverW9Client.js'

const inputStyle = {
  width: '100%',
  marginTop: 6,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(82,45,128,0.16)',
  fontSize: 16,
  boxSizing: 'border-box',
}

function todayDate() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function DriverW9() {
  const { user, loading: authLoading } = useAuth()
  const [legalName, setLegalName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [taxClass, setTaxClass] = useState(TAX_CLASSIFICATIONS[0]?.id || 'individual')
  const [address, setAddress] = useState('')
  const [tinKind, setTinKind] = useState('ssn')
  const [tin, setTin] = useState('')
  const [certified, setCertified] = useState(false)
  const [signature, setSignature] = useState('')
  const [signedOn, setSignedOn] = useState(todayDate)
  const [desk, setDesk] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (authLoading || !user?.id) return undefined
    let alive = true
    loadDriverW9(supabase, user.id)
      .then((next) => {
        if (!alive) return
        setDesk(next)
        const status = next.status
        if (status?.legalName) setLegalName(status.legalName)
        if (status?.businessName) setBusinessName(status.businessName)
        if (status?.taxClassification) setTaxClass(status.taxClassification)
        if (status?.address) setAddress(status.address)
        if (status?.tinKind === 'ssn' || status?.tinKind === 'ein') setTinKind(status.tinKind)
        if (status?.signatureName) setSignature(status.signatureName)
        if (status?.signedOn) setSignedOn(status.signedOn)
        if (status?.certified) setCertified(true)
        setTin('')
        setLoaded(true)
      })
      .catch((err) => {
        if (!alive) return
        setError(err.message || 'Could not load your W-9')
        setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [authLoading, user?.id])

  const issue = w9FormIssue({
    legalName,
    businessName,
    taxClassification: taxClass,
    address,
    tin,
    tinKind,
    certified,
    signatureName: signature,
    signedOn,
  })

  async function onSave(event) {
    event.preventDefault()
    if (issue) {
      setError(issue)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await saveDriverW9Record(supabase, {
        legalName,
        businessName,
        taxClassification: taxClass,
        address,
        tin,
        tinKind,
        certified: true,
        signatureName: signature,
        signedOn,
      })
      setTin('')
      setDesk({ stripeConnect: false, status: saved })
    } catch (err) {
      setError(err.message || 'Could not save the W-9')
    } finally {
      setBusy(false)
    }
  }

  const stripe = Boolean(desk?.stripeConnect)

  return (
    <div style={{ minHeight: '100%', overflowY: 'auto', background: 'linear-gradient(180deg, rgba(245,102,0,0.1), rgba(82,45,128,0.06) 32%, #f7f5f8)' }}>
      <form onSubmit={onSave} style={{ padding: '18px 18px 28px', maxWidth: 560, margin: '0 auto' }} data-testid="w9-form">
        <button type="button" className="pressable" onClick={() => navigate('earnings')} style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 14 }}>
          ← Earnings
        </button>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>Tax info</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--purple)', marginTop: 2 }}>W-9</h1>
        <p data-testid="w9-status" style={{ fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
          {w9StatusLabel(desk)}
        </p>
        {error ? <p role="alert" className="field-error-text">{error}</p> : null}
        {!loaded && user ? (
          <p style={{ fontSize: 14, color: 'var(--ink-secondary)' }}>Loading W-9</p>
        ) : null}
        {loaded && stripe ? (
          <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 22 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
              This payout account is on Stripe Connect. Open Stripe to update tax classification and the taxpayer identification number. The full number is not stored in this app.
            </p>
            {desk?.updateUrl ? (
              <a href={desk.updateUrl} style={{ display: 'inline-block', marginTop: 8, fontWeight: 800, color: 'var(--purple)' }}>
                Open Stripe tax info
              </a>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{desk?.stripeError || 'Stripe link unavailable.'}</p>
            )}
          </div>
        ) : null}
        {loaded && !stripe ? (
          <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Legal name
              <input value={legalName} onChange={(event) => setLegalName(event.target.value)} style={inputStyle} autoComplete="name" />
            </label>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Business name
              <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} style={inputStyle} placeholder="Optional" />
            </label>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Federal tax classification
              <select value={taxClass} onChange={(event) => setTaxClass(event.target.value)} style={inputStyle}>
                {TAX_CLASSIFICATIONS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Address
              <input value={address} onChange={(event) => setAddress(event.target.value)} style={inputStyle} autoComplete="street-address" />
            </label>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>TIN (SSN or EIN)</legend>
              <label style={{ marginRight: 16 }}>
                <input type="radio" name="tin-kind" checked={tinKind === 'ssn'} onChange={() => setTinKind('ssn')} /> SSN
              </label>
              <label>
                <input type="radio" name="tin-kind" checked={tinKind === 'ein'} onChange={() => setTinKind('ein')} /> EIN
              </label>
              <input
                value={tin}
                onChange={(event) => setTin(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                type="password"
                placeholder="9 digits"
                aria-label={tinKind === 'ein' ? 'EIN' : 'SSN'}
                style={inputStyle}
              />
            </fieldset>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45 }}>
              <input type="checkbox" checked={certified} onChange={(event) => setCertified(event.target.checked)} style={{ marginTop: 3 }} />
              <span>I certify that the legal name, federal tax classification, address, and taxpayer identification number are correct, and I sign this W-9 electronically.</span>
            </label>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>
              E-signature
              <input value={signature} onChange={(event) => setSignature(event.target.value)} style={inputStyle} placeholder="Type your legal name" />
            </label>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Date
              <input value={signedOn} onChange={(event) => setSignedOn(event.target.value)} style={inputStyle} placeholder="YYYY-MM-DD" />
            </label>
            {issue ? <p id="w9-continue-reason" role="alert" className="field-error-text">{issue}</p> : null}
            <button
              type="submit"
              className="pressable"
              disabled={busy || Boolean(issue)}
              aria-describedby={issue ? 'w9-continue-reason' : undefined}
              style={{ padding: 12, borderRadius: 14, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg, var(--orange), #ff7a1a)' }}
            >
              {busy ? 'Saving…' : 'Save W-9'}
            </button>
          </div>
        ) : null}
      </form>
    </div>
  )
}
