import { useEffect, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import {
  applyAffiliate, formatCents, loadAffiliateMe, lookupAffiliate, recordAffiliateClick,
  rememberAffiliateRef, setAffiliateRefRole,
} from '../lib/affiliates'
import { AFFILIATE_PARTNER_LABELS, AFFILIATE_PARTNER_TYPES } from '../../shared/affiliates/config.js'
import { normalizeAffiliateCode } from '../../shared/affiliates/rules.js'

export const ORANGE = '#F56600'
export const PURPLE = '#522D80'
export const card = { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(17,12,34,0.06), 0 4px 14px rgba(17,12,34,0.06)' }
const page = { minHeight: '100%', background: 'var(--surface, #f7f6fa)', padding: '24px 16px 48px' }
const wrap = { maxWidth: 720, margin: '0 auto', display: 'grid', gap: 16 }
const label = { display: 'grid', gap: 6, fontWeight: 700, fontSize: 14, color: '#2a2438' }
const input = { padding: '12px 14px', borderRadius: 12, border: '1px solid #e3e0ea', fontSize: 16, background: '#fff' }
const eyebrow = { fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: ORANGE }
const DRAFT_KEY = 'clemson_affiliate_draft'

/** /affiliates — public partner sign-up; signed-in partners see their dashboard. */
export function AffiliatesScreen() {
  const { user, loading } = useAuth()
  const [me, setMe] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!user?.id) { setMe(null); return undefined }
    let alive = true
    loadAffiliateMe().then((d) => { if (alive) setMe(d) }).catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [user?.id])
  if (loading) return <div style={page} />
  if (me?.affiliate) return <AffiliateDashboard data={me} />
  return <AffiliateSignup user={user} onDone={setMe} loadError={err} />
}

function AffiliateSignup({ user, onDone, loadError }) {
  const [form, setForm] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') || { partner_type: 'student' } } catch { return { partner_type: 'student' } }
  })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(loadError)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const needsOrg = form.partner_type === 'campus_org' || form.partner_type === 'local_business'

  async function submit(e) {
    e.preventDefault()
    if (!user) {
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch { /* ignore */ }
      navigate('sign-up', { next: 'affiliates' })
      return
    }
    setBusy(true); setMsg(null)
    try {
      await applyAffiliate({ ...form, contact_email: form.contact_email || user.email })
      try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      onDone(await loadAffiliateMe())
    } catch (err) {
      setErrors(err?.payload?.errors || {})
      setMsg(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div style={page}>
      <div style={wrap}>
        <div style={{ ...card, background: `linear-gradient(135deg, ${PURPLE} 0%, #6b3fa0 100%)`, color: '#fff' }}>
          <div style={{ ...eyebrow, color: '#ffd2b0' }}>CLEMSON RIDES PARTNERS</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: '6px 0', letterSpacing: -0.4 }}>Share rides. Earn rewards.</h1>
          <p style={{ opacity: 0.9, lineHeight: 1.5, margin: 0 }}>
            Students, campus orgs, local businesses and creators get a personal link. When someone you refer takes
            their first ride, or a new driver finishes their first trip, you earn a reward.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[['1', 'Get your code', 'clemsonrides.com/r/YOURCODE'], ['2', 'Share it', 'Flyers, group chats, socials'], ['3', 'Earn', 'Ride credit or test-mode payouts']].map(([n, t, d]) => (
            <div key={n} style={card}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{n}</div>
              <div style={{ fontWeight: 800, marginTop: 8 }}>{t}</div>
              <div style={{ color: '#6b6478', fontSize: 14 }}>{d}</div>
            </div>
          ))}
        </div>
        <form onSubmit={submit} style={{ ...card, display: 'grid', gap: 14 }} noValidate>
          <h2 style={{ margin: 0, fontSize: 20, color: PURPLE }}>Apply to be a partner</h2>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <legend style={{ ...label, marginBottom: 6 }}>I am a…</legend>
            {AFFILIATE_PARTNER_TYPES.map((t) => (
              <button key={t} type="button" className="pressable" aria-pressed={form.partner_type === t}
                onClick={() => setForm((f) => ({ ...f, partner_type: t }))}
                style={{ padding: '10px 14px', borderRadius: 999, fontWeight: 700, minHeight: 44,
                  border: form.partner_type === t ? `2px solid ${ORANGE}` : '1px solid #e3e0ea',
                  background: form.partner_type === t ? '#fff4ec' : '#fff', color: form.partner_type === t ? ORANGE : '#2a2438' }}>
                {AFFILIATE_PARTNER_LABELS[t]}
              </button>
            ))}
          </fieldset>
          <Field label="Your name" error={errors.display_name}><input style={input} value={form.display_name || ''} onChange={set('display_name')} autoComplete="name" /></Field>
          {needsOrg && <Field label="Organization or business" error={errors.org_name}><input style={input} value={form.org_name || ''} onChange={set('org_name')} /></Field>}
          <Field label="Email" error={errors.contact_email}><input style={input} type="email" value={form.contact_email ?? user?.email ?? ''} onChange={set('contact_email')} autoComplete="email" /></Field>
          <Field label="Phone (optional)" error={errors.phone}><input style={input} type="tel" value={form.phone || ''} onChange={set('phone')} autoComplete="tel" /></Field>
          <Field label="Website or social handle (optional)"><input style={input} value={form.website || ''} onChange={set('website')} /></Field>
          <Field label="Where will you share your link?"><textarea style={{ ...input, minHeight: 80 }} value={form.audience || ''} onChange={set('audience')} /></Field>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
            <input type="checkbox" checked={Boolean(form.agree)} onChange={set('agree')} style={{ width: 20, height: 20 }} />
            <span>I agree not to refer myself, create duplicate accounts, or pay people to sign up. Rewards are reviewed before payout.</span>
          </label>
          {errors.agree && <span role="alert" style={{ color: 'var(--danger, #c0392b)', fontSize: 13 }}>{errors.agree}</span>}
          {msg && <p role="alert" style={{ color: 'var(--danger, #c0392b)', margin: 0 }}>{msg}</p>}
          <PrimaryButton type="submit" loading={busy}>{user ? 'Get my partner link' : 'Create account to continue'}</PrimaryButton>
        </form>
      </div>
    </div>
  )
}

function Field({ label: text, error, children }) {
  return (
    <label style={label}>
      {text}
      {children}
      {error && <span role="alert" style={{ color: 'var(--danger, #c0392b)', fontSize: 13, fontWeight: 600 }}>{error}</span>}
    </label>
  )
}

function Stat({ label: text, value, tone = PURPLE }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 13, color: '#6b6478', fontWeight: 700 }}>{text}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: tone }}>{value}</div>
    </div>
  )
}

export function AffiliateDashboard({ data }) {
  const [tab, setTab] = useState('overview')
  const [copied, setCopied] = useState(false)
  const { affiliate, stats = {}, earnings = {}, ledger = [], materials_url: materials, rates = {} } = data
  const copy = async () => {
    try { await navigator.clipboard.writeText(affiliate.link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }
  return (
    <div style={page}>
      <div style={wrap}>
        <div style={card}>
          <div style={eyebrow}>PARTNER DASHBOARD</div>
          <h1 style={{ margin: '4px 0 2px', color: PURPLE, fontSize: 26 }}>{affiliate.org_name || affiliate.display_name}</h1>
          <div style={{ color: '#6b6478', fontSize: 14 }}>{AFFILIATE_PARTNER_LABELS[affiliate.partner_type]} · {affiliate.status === 'active' ? 'Active' : affiliate.status === 'pending' ? 'Pending review — your link works once approved' : affiliate.status}</div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ background: '#f4f1f8', padding: '10px 12px', borderRadius: 12, fontSize: 15, fontWeight: 700 }}>{affiliate.link}</code>
            <button type="button" className="pressable" onClick={copy} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, background: ORANGE, color: '#fff', fontWeight: 800 }}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
        <div role="tablist" aria-label="Partner dashboard" style={{ display: 'flex', gap: 8, background: '#ece9f2', padding: 4, borderRadius: 999, width: 'fit-content' }}>
          {[['overview', 'Overview'], ['earnings', 'Earnings'], ['materials', 'Materials']].map(([k, t]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} className="pressable" onClick={() => setTab(k)}
              style={{ minHeight: 40, padding: '0 16px', borderRadius: 999, fontWeight: 800, background: tab === k ? '#fff' : 'transparent', color: tab === k ? PURPLE : '#6b6478', boxShadow: tab === k ? '0 1px 3px rgba(17,12,34,0.12)' : 'none' }}>{t}</button>
          ))}
        </div>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Stat label="Link clicks" value={stats.clicks || 0} />
            <Stat label="Signups" value={stats.signups || 0} />
            <Stat label="Qualified referrals" value={stats.qualified || 0} tone={ORANGE} />
            <Stat label="Total earned" value={formatCents((earnings.pending_cents || 0) + (earnings.approved_cents || 0) + (earnings.paid_cents || 0))} tone={ORANGE} />
            <div style={{ ...card, gridColumn: '1 / -1', fontSize: 14, color: '#4a4358', lineHeight: 1.5 }}>
              A referral qualifies when a new rider finishes their first ride ({formatCents(rates.rider_first_ride_cents)}) or a new driver finishes their first trip ({formatCents(rates.driver_first_trip_cents)}).
              Rewards stay pending for {rates.hold_days ?? 14} days, then go into an approved payout batch.
              {rates.placeholder && <strong> Reward amounts are not final yet and may change.</strong>}
            </div>
          </div>
        )}
        {tab === 'earnings' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <Stat label="Pending" value={formatCents(earnings.pending_cents)} />
              <Stat label="Approved" value={formatCents(earnings.approved_cents)} />
              <Stat label="Paid" value={formatCents(earnings.paid_cents)} tone={ORANGE} />
            </div>
            <div style={card}>
              {ledger.length === 0 && <p style={{ margin: 0, color: '#6b6478' }}>No rewards yet. Share your link to get started.</p>}
              {ledger.map((l) => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f0edf4' }}>
                  <span>{l.kind === 'referral_driver' ? 'New driver first trip' : l.kind === 'referral_rider' ? 'New rider first ride' : 'Adjustment'} · {new Date(l.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}</span>
                  <span style={{ fontWeight: 800 }}>{formatCents(l.amount_cents)} <small style={{ color: '#6b6478', textTransform: 'capitalize' }}>{l.status}</small></span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'materials' && (
          <div style={{ ...card, display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: '#6b6478', fontWeight: 700 }}>Your code</div>
              <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2, color: ORANGE }}>{affiliate.code}</div>
              <div style={{ color: '#4a4358' }}>Link: <strong>{affiliate.link}</strong></div>
            </div>
            <p style={{ margin: 0, color: '#4a4358', lineHeight: 1.5 }}>Logos, flyers, social posts and brand colors (orange #F56600, purple #522D80) live in the shared Drive folder. Put your code or link on anything you share.</p>
            <a href={materials} target="_blank" rel="noreferrer" className="pressable"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 14, background: PURPLE, color: '#fff', fontWeight: 800, textDecoration: 'none' }}>
              Open marketing materials
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

/** /r/CODE — partner link landing. Records a click, remembers the code for signup. */
export function AffiliateLanding() {
  const code = normalizeAffiliateCode((typeof window !== 'undefined' ? window.location.pathname : '').split('/')[2] || '')
  const { user } = useAuth()
  const [partner, setPartner] = useState(undefined)
  useEffect(() => {
    if (!code) { setPartner(null); return }
    rememberAffiliateRef(code, 'rider')
    recordAffiliateClick(code).catch(() => {})
    lookupAffiliate(code).then(setPartner).catch(() => setPartner(null))
  }, [code])
  const go = (role) => {
    setAffiliateRefRole(role)
    if (role === 'driver') navigate(user ? 'driver-signup' : 'sign-up', user ? {} : { next: 'driver-signup' })
    else navigate(user ? 'home' : 'sign-up')
  }
  return (
    <div style={page}>
      <div style={wrap}>
        <div style={card}>
          <div style={eyebrow}>INVITED TO CLEMSON RIDES</div>
          <h1 style={{ color: PURPLE, fontSize: 28, margin: '6px 0' }}>
            {partner ? `${partner.display_name} sent you` : partner === null ? 'Welcome to Clemson Rides' : 'Loading…'}
          </h1>
          <p style={{ color: '#4a4358', lineHeight: 1.5 }}>Airport and around-town rides from local drivers. Create your account to ride, or apply to drive.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <PrimaryButton onClick={() => go('rider')}>Sign up to ride</PrimaryButton>
            <PrimaryButton variant="purple" onClick={() => go('driver')}>Apply to drive</PrimaryButton>
          </div>
          {partner === null && code && <p style={{ color: '#6b6478', fontSize: 13 }}>This partner link is not active, but you can still sign up.</p>}
        </div>
      </div>
    </div>
  )
}
