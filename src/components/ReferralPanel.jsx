import { useEffect, useState } from 'react'
import { IconShare } from './icons'
import {
  REFERRAL_REFEREE_CENTS,
  REFERRAL_REFERRER_CENTS,
  applyReferralCode,
  copyText,
  fetchReferralSummary,
  formatCreditCents,
  isValidReferralCode,
  normalizeReferralCode,
  referralShareUrl,
  referralStatusLabel,
} from '../lib/referrals'

const ORANGE = '#F56600'
const PURPLE = '#522D80'

function ledgerLabel(reason) {
  if (reason === 'referral_referrer') return 'Referral reward'
  if (reason === 'referral_referee') return 'Welcome credit'
  if (reason === 'social_promo_referrer' || reason === 'social_promo_invitee') return 'Rider promo credit'
  return 'Platform credit'
}

export function ReferralPanel() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [applyMsg, setApplyMsg] = useState(null)
  const [applying, setApplying] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchReferralSummary()
      setSummary(data)
    } catch (err) {
      setError(err.message || 'Could not load your referral code')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function onCopy(kind) {
    if (!summary?.code) return
    const text = kind === 'link' ? referralShareUrl(summary.code) : summary.code
    try {
      await copyText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied(''), 1600)
    } catch (err) {
      setError(err.message || 'Could not copy')
    }
  }

  async function onShare() {
    if (!summary?.code) return
    const url = referralShareUrl(summary.code)
    const text = `Ride with me on Clemson RIDES. Use my code ${summary.code} — we both get credit after your first trip.`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Clemson RIDES', text, url })
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
      }
    }
    await onCopy('link')
  }

  async function onApply(e) {
    e.preventDefault()
    const code = normalizeReferralCode(codeInput)
    if (!isValidReferralCode(code)) {
      setApplyMsg('Enter a code like TGR-ABC234.')
      return
    }
    setApplying(true)
    setApplyMsg(null)
    try {
      const res = await applyReferralCode(code)
      setApplyMsg(`Code saved. You and ${res.referrerFirstName || 'your friend'} both earn credit after your first trip.`)
      setCodeInput('')
      await load()
    } catch (err) {
      setApplyMsg(err.message || 'Could not apply that code')
    } finally {
      setApplying(false)
    }
  }

  if (loading && !summary) {
    return (
      <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18, color: PURPLE }}>
        Loading your referral code…
      </div>
    )
  }

  const you = formatCreditCents(summary?.referrerCents ?? REFERRAL_REFERRER_CENTS)
  const them = formatCreditCents(summary?.refereeCents ?? REFERRAL_REFEREE_CENTS)

  return (
    <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconShare size={20} color={ORANGE} />
        <div style={{ fontWeight: 800, color: PURPLE }}>Refer friends</div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '6px 0 12px', lineHeight: 1.45 }}>
        Riders and drivers can share a code. You both receive platform credits when they finish
        their first ride, or their first completed trip as a driver. One welcome credit per new
        account — a referral and a rider promo code do not both pay.
      </p>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{error}</div>
      )}

      <div
        style={{
          borderRadius: 18,
          padding: 16,
          color: '#fff',
          background: `linear-gradient(135deg, ${ORANGE} 0%, ${PURPLE} 100%)`,
          boxShadow: '0 10px 24px rgba(82,45,128,0.22)',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, opacity: 0.9 }}>PLATFORM CREDITS</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.6, marginTop: 2 }}>
          {formatCreditCents(summary?.balanceCents)}
        </div>
        <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.4 }}>
          You get {you} · they get {them}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: '14px 12px',
          borderRadius: 16,
          textAlign: 'center',
          background: 'rgba(82,45,128,0.08)',
          border: '1px solid rgba(82,45,128,0.16)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.1, color: ORANGE }}>YOUR CODE</div>
        <div
          style={{
            marginTop: 4,
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 1.5,
            color: PURPLE,
          }}
          aria-label="Your referral code"
        >
          {summary?.code || '—'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="pressable"
          onClick={() => onCopy('code')}
          style={actionStyle(copied === 'code')}
        >
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
        <button
          type="button"
          className="pressable"
          onClick={() => onCopy('link')}
          style={actionStyle(copied === 'link')}
        >
          {copied === 'link' ? 'Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          className="pressable"
          onClick={onShare}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 14,
            fontWeight: 700,
            color: '#fff',
            background: `linear-gradient(135deg, ${ORANGE}, #ff7a1a)`,
          }}
        >
          Share
        </button>
      </div>

      <ol style={{ margin: '14px 0 0', paddingLeft: 18, color: PURPLE, fontSize: 13, lineHeight: 1.45 }}>
        <li>Share your link or code from Account.</li>
        <li>They create an account with that code.</li>
        <li>After their first completed ride or first drive, you both get credit.</li>
      </ol>

      <div style={{ marginTop: 16, fontWeight: 800, color: PURPLE, fontSize: 14 }}>People you referred</div>
      {(summary?.referrals || []).length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginTop: 6 }}>
          No one has used your code yet.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {summary.referrals.map((row) => (
            <li
              key={row.id || `${row.firstName}-${row.createdAt}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.55)',
                border: '1px solid rgba(82,45,128,0.1)',
              }}
            >
              <span style={{ fontWeight: 700, color: PURPLE }}>{row.firstName}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-secondary)', textAlign: 'right' }}>
                {referralStatusLabel(row)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {summary?.referredBy && (
        <div style={{ marginTop: 14, fontSize: 13, color: PURPLE, lineHeight: 1.45 }}>
          You joined with {summary.referredBy.firstName}&apos;s code · {referralStatusLabel(summary.referredBy)}
        </div>
      )}

      {summary?.canApply && (
        <form onSubmit={onApply} style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, color: PURPLE, fontSize: 14 }}>Have a code?</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="TGR-ABC234"
              aria-label="Referral code"
              autoCapitalize="characters"
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 14,
                border: '1px solid rgba(82,45,128,0.18)',
                background: 'rgba(255,255,255,0.7)',
                color: PURPLE,
                fontWeight: 700,
                letterSpacing: 0.6,
              }}
            />
            <button
              type="submit"
              className="pressable"
              disabled={applying}
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                fontWeight: 700,
                color: '#fff',
                background: PURPLE,
                opacity: applying ? 0.7 : 1,
              }}
            >
              {applying ? '…' : 'Apply'}
            </button>
          </div>
        </form>
      )}

      {!summary?.canApply && !summary?.referredBy && summary && (
        <p style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-tertiary)', lineHeight: 1.45 }}>
          Referral codes can only be added before your first completed trip.
        </p>
      )}

      {applyMsg && (
        <div style={{ marginTop: 10, fontSize: 13, color: PURPLE }}>{applyMsg}</div>
      )}
    </div>
  )
}

function actionStyle(on) {
  return {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    fontWeight: 700,
    color: on ? '#fff' : PURPLE,
    background: on ? PURPLE : 'rgba(255,255,255,0.7)',
    border: `1px solid rgba(82,45,128,${on ? '0' : '0.2'})`,
  }
}
