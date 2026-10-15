import { useCallback, useEffect, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import {
  affiliateConnectQuery, applyAffiliate, clearAffiliateConnectQuery, formatCents,
  loadAffiliateMe, loadAffiliatePlan, lookupAffiliate, recordAffiliateClick,
  rememberAffiliateRef, setAffiliateRefRole, startAffiliateConnect, subscribeAffiliateDashboard,
  syncAffiliateConnect,
} from '../lib/affiliates'
import { AFFILIATE_PARTNER_LABELS, AFFILIATE_PARTNER_TYPES } from '../../shared/affiliates/config.js'
import { describeAffiliatePlan, normalizeAffiliateCode, referralStatusLabel } from '../../shared/affiliates/rules.js'

export const ORANGE = '#F56600'
export const PURPLE = '#522D80'
export const card = {
  background: 'rgba(255, 252, 248, 0.82)',
  borderRadius: 20,
  padding: 20,
  border: '1px solid rgba(255,255,255,0.85)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 28px rgba(82,45,128,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  transition: 'transform .2s ease, opacity .2s ease',
}
const page = { minHeight: '100%', background: '#F7F4F0', padding: '20px 16px 64px' }
const wrap = { maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }
const labelStyle = { display: 'grid', gap: 6, fontWeight: 700, fontSize: 14, color: '#2a2438' }
const input = { padding: '12px 14px', borderRadius: 18, border: '1px solid rgba(82,45,128,0.12)', fontSize: 17, fontWeight: 600, color: '#0B1220', background: '#fff' }
const eyebrow = { fontSize: 11, fontWeight: 800, letterSpacing: 1.1, color: ORANGE }
const DRAFT_KEY = 'clemson_affiliate_draft'

const CONNECT = {
  not_started: { label: 'Not started', hint: 'Connect a bank account to receive payouts.', cta: 'Set up payouts' },
  pending: { label: 'Pending', hint: 'Stripe is finishing a review, or setup still needs a step.', cta: 'Continue setup' },
  verified: { label: 'Verified', hint: 'Approved commissions transfer here automatically.', cta: null },
  restricted: { label: 'Restricted', hint: 'Stripe needs an update before payouts can be sent.', cta: 'Update account' },
}

/** /affiliates — public partner sign-up; signed-in partners see their dashboard. */
export function AffiliatesScreen() {
  const { user, loading } = useAuth()
  const [me, setMe] = useState(null)
  const [err, setErr] = useState(null)
  const [live, setLive] = useState(false)
  const refresh = useCallback(() => {
    if (!user?.id) { setMe(null); return Promise.resolve(null) }
    return loadAffiliateMe().then((d) => { setMe(d); if (d) setLive(true); return d }).catch((e) => { setErr(e.message); return null })
  }, [user?.id])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const id = me?.affiliate?.id
    if (!id) return undefined
    let timer
    const stop = subscribeAffiliateDashboard(id, () => {
      setLive(true)
      clearTimeout(timer)
      timer = setTimeout(() => refresh(), 250)
    })
    const poll = setInterval(() => refresh(), 8000)
    return () => { stop(); clearTimeout(timer); clearInterval(poll) }
  }, [me?.affiliate?.id, refresh])

  useEffect(() => {
    const flag = affiliateConnectQuery()
    if (!user?.id || !me?.affiliate || (flag !== 'return' && flag !== 'refresh')) return undefined
    let alive = true
    clearAffiliateConnectQuery()
    ;(async () => {
      try {
        if (flag === 'refresh') {
          const out = await startAffiliateConnect()
          if (alive && out?.url) window.location.assign(out.url)
          return
        }
        await syncAffiliateConnect()
        if (alive) await refresh()
      } catch (e) {
        if (alive) setErr(e.message)
      }
    })()
    return () => { alive = false }
  }, [user?.id, me?.affiliate?.id, refresh])

  if (loading) return <div style={page} />
  if (me?.affiliate) return <AffiliateDashboard data={me} live={live} loadError={err} onRefresh={refresh} />
  return <AffiliateSignup user={user} onDone={setMe} loadError={err} />
}

export function AffiliateSignup({ user, onDone, loadError }) {
  const [form, setForm] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') || { partner_type: 'student' } } catch { return { partner_type: 'student' } }
  })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(loadError)
  const [plan, setPlan] = useState(() => describeAffiliatePlan())
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const needsOrg = form.partner_type === 'campus_org' || form.partner_type === 'local_business'

  useEffect(() => {
    let alive = true
    loadAffiliatePlan().then((d) => { if (alive && d?.plan) setPlan(d.plan) }).catch(() => {})
    return () => { alive = false }
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!user) {
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch { /* ignore */ }
      const here = (typeof window !== 'undefined'
        ? ((window.location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0]
          || window.location.pathname.replace(/^\//, '').split('/')[0])
        : '')
      navigate('sign-up', { next: here === 'affiliate' ? 'affiliate' : 'affiliates' })
      return
    }
    setBusy(true); setMsg(null)
    try {
      await applyAffiliate({ ...form, contact_email: form.contact_email || user.email })
      try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      onDone(await loadAffiliateMe())
    } catch (error) {
      setErrors(error?.payload?.errors || {})
      setMsg(error.message)
    } finally { setBusy(false) }
  }

  return (
    <div style={page}>
      <div style={wrap}>
        <div className="rider-card rider-card--invert" style={{ ...card, background: `linear-gradient(160deg, ${PURPLE} 0%, #6b3fa0 70%, #8a4fbf 100%)`, color: '#fff' }}>
          <div style={{ ...eyebrow, color: '#ffd2b0' }}>Clemson Rides partners</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: '6px 0', letterSpacing: -0.6 }}>Share rides. Earn rewards.</h1>
          <p style={{ opacity: 0.92, lineHeight: 1.5, margin: 0 }}>
            Students, campus groups, local businesses, and creators get a personal link. Rewards follow {plan.plan_label}.
          </p>
        </div>
        <AffiliatePlan plan={plan} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[['1', 'Get your code', 'clemsonrides.com/r/YOURCODE'], ['2', 'Share it', 'Flyers, group chats, socials'], ['3', 'Earn', 'After the first qualifying ride']].map(([n, t, d]) => (
            <div key={n} className="rider-card" style={card}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{n}</div>
              <div style={{ fontWeight: 800, marginTop: 8 }}>{t}</div>
              <div style={{ color: '#6b6478', fontSize: 14 }}>{d}</div>
            </div>
          ))}
        </div>
        <form onSubmit={submit} className="rider-card" style={{ ...card, display: 'grid', gap: 14 }} noValidate>
          <h2 style={{ margin: 0, fontSize: 20, color: PURPLE }}>Apply to be a partner</h2>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <legend style={{ ...labelStyle, marginBottom: 6 }}>I am a…</legend>
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

export function AffiliatePlan({ plan }) {
  const rows = plan?.partners || []
  return (
    <section className="rider-card" style={card} aria-label="Commission plan">
      <div style={eyebrow}>{plan?.plan_label || 'Option C'}</div>
      <h2 style={{ margin: '4px 0 12px', color: PURPLE, fontSize: 22 }}>How partners earn</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <PlanFact title="Qualified rider" value={formatCents(plan?.rider_first_ride_cents)} detail={`First completed fare of at least ${formatCents(plan?.rider_min_fare_cents)}`} />
        <PlanFact title="Qualified driver" value={formatCents(plan?.driver_first_trip_cents)} detail="First completed trip" />
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, color: '#2a2438' }}>Partner bonuses</div>
        {plan?.multipliers_pending_confirmation && (
          <p style={{ margin: '4px 0 8px', color: ORANGE, fontWeight: 700, fontSize: 13 }}>{plan.multipliers_note || 'Proposed bonuses for John to confirm.'}</p>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <div key={row.type} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid #f0edf4' }}>
              <span style={{ fontWeight: 700 }}>{row.label}{row.bonus ? ` · ${row.multiplier_label}` : ' · base rate'}</span>
              <span style={{ color: '#4a4358', fontSize: 14, textAlign: 'right' }}>{formatCents(row.rider_cents)} rider · {formatCents(row.driver_cents)} driver</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function PlanFact({ title, value, detail }) {
  return (
    <div style={{ background: '#faf8fc', borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 13, color: '#6b6478', fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: ORANGE, letterSpacing: -0.4 }}>{value}</div>
      <div style={{ fontSize: 13, color: '#4a4358' }}>{detail}</div>
    </div>
  )
}

function Field({ label: text, error, children }) {
  return (
    <label style={labelStyle}>
      {text}
      {children}
      {error && <span role="alert" style={{ color: 'var(--danger, #c0392b)', fontSize: 13, fontWeight: 600 }}>{error}</span>}
    </label>
  )
}

function Stat({ label: text, value, tone = PURPLE }) {
  return (
    <div className="rider-card" style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 13, color: '#6b6478', fontWeight: 700 }}>{text}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: tone, letterSpacing: -0.4 }}>{value}</div>
    </div>
  )
}

const PAYOUT_LABELS = {
  'transfer.created': 'Transfer created',
  'transfer.updated': 'Transfer updated',
  'transfer.reversed': 'Transfer reversed',
  'transfer.paid': 'Transfer paid',
  'payout.created': 'Payout created',
  'payout.updated': 'Payout updated',
  'payout.paid': 'Payout paid',
  'payout.failed': 'Payout failed',
  'payout.canceled': 'Payout canceled',
  ride_credit: 'Ride credit',
  commission_paid: 'Commission paid',
}

function when(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

export function AffiliateDashboard({ data, live = false, loadError = null, onRefresh, initialTab = 'overview' }) {
  const [tab, setTab] = useState(initialTab)
  const [copied, setCopied] = useState(false)
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectErr, setConnectErr] = useState(loadError)
  const { affiliate, stats = {}, earnings = {}, ledger = [], referrals = [], payouts = [], materials_url: materials, plan } = data
  const commission = plan || describeAffiliatePlan()
  const connect = CONNECT[affiliate.connect_status] || CONNECT.not_started
  const copy = async () => {
    try { await navigator.clipboard.writeText(affiliate.link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }
  const beginConnect = async () => {
    setConnectBusy(true); setConnectErr(null)
    try {
      const out = await startAffiliateConnect()
      if (out?.url) window.location.assign(out.url)
      else setConnectErr('Stripe did not return an onboarding link')
    } catch (error) {
      setConnectErr(error.message)
    } finally { setConnectBusy(false) }
  }
  return (
    <div style={page}>
      <style>{'@keyframes affiliate-live{0%,100%{opacity:1}50%{opacity:.35}}'}</style>
      <div style={wrap}>
        <div className="rider-card" style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div style={eyebrow}>PARTNER DASHBOARD</div>
            <div aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: live ? '#0f7b4c' : '#6b6478' }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: live ? '#0f7b4c' : ORANGE, animation: live ? 'affiliate-live 1.6s ease infinite' : undefined }} />
              {live ? 'Live' : 'Updating'}
            </div>
          </div>
          <h1 style={{ margin: '4px 0 2px', color: PURPLE, fontSize: 26 }}>{affiliate.org_name || affiliate.display_name}</h1>
          <div style={{ color: '#6b6478', fontSize: 14 }}>{AFFILIATE_PARTNER_LABELS[affiliate.partner_type]} · {affiliate.status === 'active' ? 'Active' : affiliate.status === 'pending' ? 'Pending review — your link works once approved' : affiliate.status}</div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ background: '#f4f1f8', padding: '10px 12px', borderRadius: 12, fontSize: 15, fontWeight: 700, wordBreak: 'break-all' }}>{affiliate.link}</code>
            <button type="button" className="pressable mkt-glass-primary" onClick={copy} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, background: ORANGE, color: '#fff', fontWeight: 800 }}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>

        <section className="rider-card" style={card} aria-label="Payout account">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={eyebrow}>PAYOUTS</div>
              <h2 style={{ margin: '4px 0', fontSize: 18, color: PURPLE }}>Stripe Connect</h2>
            </div>
            <StatusPill status={affiliate.connect_status} label={connect.label} />
          </div>
          <p style={{ margin: '8px 0 0', color: '#4a4358', lineHeight: 1.5 }}>{connect.hint} Transfers run in Stripe test mode after an admin approves a commission.</p>
          {connectErr && <p role="alert" style={{ color: '#c0392b' }}>{connectErr}</p>}
          {connect.cta && (
            <button type="button" className="pressable mkt-glass-primary" disabled={connectBusy} onClick={beginConnect}
              style={{ marginTop: 12, minHeight: 48, padding: '0 18px', borderRadius: 14, background: ORANGE, color: '#fff', fontWeight: 800, width: '100%' }}>
              {connectBusy ? 'Opening Stripe…' : connect.cta}
            </button>
          )}
        </section>

        <div role="tablist" aria-label="Partner dashboard" style={{ display: 'flex', gap: 8, background: '#ece9f2', padding: 4, borderRadius: 999, overflowX: 'auto' }}>
          {[['overview', 'Overview'], ['referrals', 'Referrals'], ['earnings', 'Earnings'], ['materials', 'Materials']].map(([k, t]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} className="pressable" onClick={() => setTab(k)}
              style={{ minHeight: 40, padding: '0 16px', borderRadius: 999, fontWeight: 800, flex: '0 0 auto', background: tab === k ? '#fff' : 'transparent', color: tab === k ? PURPLE : '#6b6478', boxShadow: tab === k ? '0 1px 3px rgba(17,12,34,0.12)' : 'none', transition: 'background .2s ease, box-shadow .2s ease' }}>{t}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <Stat label="Link clicks" value={stats.clicks || 0} />
              <Stat label="Sign-ups" value={stats.signups || 0} />
              <Stat label="First rides" value={stats.rider_qualified || 0} tone={ORANGE} />
              <Stat label="First trips" value={stats.driver_qualified || 0} tone={ORANGE} />
            </div>
            <BalanceRow earnings={earnings} />
            <ReferralList referrals={referrals.slice(0, 5)} empty="No referrals yet. Share your link to get started." />
            <AffiliatePlan plan={commission} />
          </div>
        )}
        {tab === 'referrals' && <ReferralList referrals={referrals} empty="No referrals yet. Share your link to get started." />}
        {tab === 'earnings' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <BalanceRow earnings={earnings} />
            <div className="rider-card" style={card}>
              <h2 style={{ margin: '0 0 8px', fontSize: 18, color: PURPLE }}>Commissions</h2>
              {ledger.length === 0 && <p style={{ margin: 0, color: '#6b6478' }}>No rewards yet. Share your link to get started.</p>}
              {ledger.map((entry) => (
                <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0edf4' }}>
                  <span>{entry.kind === 'referral_driver' ? 'New driver first trip' : entry.kind === 'referral_rider' ? 'New rider first ride' : 'Adjustment'} · {when(entry.created_at)}</span>
                  <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatCents(entry.amount_cents)} <small style={{ color: '#6b6478', textTransform: 'capitalize' }}>{entry.status}</small></span>
                </div>
              ))}
            </div>
            <div className="rider-card" style={card}>
              <h2 style={{ margin: '0 0 8px', fontSize: 18, color: PURPLE }}>Payout history</h2>
              {payouts.length === 0 && <p style={{ margin: 0, color: '#6b6478' }}>Payouts show up here after a commission is approved.</p>}
              {payouts.map((payout) => (
                <div key={payout.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0edf4' }}>
                  <span>{PAYOUT_LABELS[payout.event_type] || payout.event_type} · {when(payout.created_at)}</span>
                  <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatCents(payout.amount_cents)} <small style={{ color: '#6b6478', textTransform: 'capitalize' }}>{payout.status}</small></span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'materials' && (
          <div className="rider-card" style={{ ...card, display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: '#6b6478', fontWeight: 700 }}>Your code</div>
              <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2, color: ORANGE }}>{affiliate.code}</div>
              <div style={{ color: '#4a4358' }}>Link: <strong>{affiliate.link}</strong></div>
            </div>
            <p style={{ margin: 0, color: '#4a4358', lineHeight: 1.5 }}>Logos, flyers, social posts and brand colors (orange #F56600, purple #522D80) live in the shared Drive folder. Put your code or link on anything you share.</p>
            <a href={materials} target="_blank" rel="noreferrer" className="pressable mkt-glass-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 14, background: PURPLE, color: '#fff', fontWeight: 800, textDecoration: 'none' }}>
              Open marketing materials
            </a>
          </div>
        )}
        {onRefresh && <button type="button" className="pressable" onClick={() => onRefresh()} style={{ justifySelf: 'start', minHeight: 44, background: 'transparent', color: PURPLE, fontWeight: 800 }}>Refresh</button>}
      </div>
    </div>
  )
}

function StatusPill({ status, label }) {
  const color = status === 'verified' ? '#0f7b4c' : status === 'restricted' ? '#c0392b' : status === 'pending' ? '#9a6200' : '#6b6478'
  const bg = status === 'verified' ? '#e8f6ee' : status === 'restricted' ? '#fdecea' : status === 'pending' ? '#fff6e5' : '#f4f1f8'
  return <span style={{ background: bg, color, fontWeight: 800, borderRadius: 999, padding: '6px 12px', fontSize: 13 }}>{label}</span>
}

function BalanceRow({ earnings }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
      <Stat label="Pending" value={formatCents(earnings.pending_cents)} />
      <Stat label="Approved" value={formatCents(earnings.approved_cents)} />
      <Stat label="Paid out" value={formatCents(earnings.paid_cents)} tone={ORANGE} />
    </div>
  )
}

function ReferralList({ referrals, empty }) {
  return (
    <div className="rider-card" style={card}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18, color: PURPLE }}>Referrals</h2>
      {referrals.length === 0 && <p style={{ margin: 0, color: '#6b6478' }}>{empty}</p>}
      {referrals.map((row) => (
        <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0edf4' }}>
          <span style={{ fontWeight: 700 }}>{row.masked_name} <small style={{ color: '#6b6478', fontWeight: 600 }}>{row.role === 'driver' ? 'Driver' : 'Rider'} · {when(row.created_at)}</small></span>
          <span style={{ fontWeight: 800, color: row.status === 'qualified' ? ORANGE : '#6b6478' }}>{referralStatusLabel(row)}</span>
        </div>
      ))}
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
        <div className="rider-card" style={card}>
          <div style={eyebrow}>Invited to Clemson Rides</div>
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
