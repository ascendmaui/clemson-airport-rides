import { useEffect, useState } from 'react'
import { IconShare } from '../components/icons'
import { loadRiderReferralAccount } from '../lib/riderReferral'
import {
  describeRiderSocialRewards,
  formatCents,
  riderPromoShareText,
  riderPromoShareUrl,
} from '../lib/riderPromo'

function Section({ title, subtitle, children }) {
  return (
    <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconShare size={20} />
        <div style={{ fontWeight: 800, color: '#522D80' }}>{title}</div>
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '4px 0 10px', lineHeight: 1.45 }}>
          {subtitle}
        </div>
      )}
      {children}
    </div>
  )
}

export function ReferFriendsPanel({ userId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState(null)
  const [shareBusy, setShareBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (!userId) return undefined
    setLoading(true)
    loadRiderReferralAccount(userId)
      .then((row) => {
        if (alive) setData(row)
      })
      .catch((e) => {
        if (alive) setNote(e.message || 'Could not load referral code')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId])

  async function onShare() {
    if (!data?.code || shareBusy) return
    const url = riderPromoShareUrl(data.code)
    const text = riderPromoShareText(data.code)
    setShareBusy(true)
    setNote(null)
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Clemson RIDES', text, url })
        setNote('Share sheet opened')
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`)
        setNote('Link copied')
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        setNote(null)
      } else {
        try {
          await navigator.clipboard.writeText(`${text} ${url}`)
          setNote('Link copied')
        } catch {
          setNote('Could not share. Copy the code instead.')
        }
      }
    } finally {
      setShareBusy(false)
    }
  }

  async function onCopy() {
    if (!data?.code) return
    const url = riderPromoShareUrl(data.code)
    const text = `${riderPromoShareText(data.code)} ${url}`
    try {
      await navigator.clipboard.writeText(text)
      setNote('Link copied')
    } catch {
      setNote(url)
    }
  }

  if (loading) {
    return <Section title="Refer friends" subtitle="Loading your code…"><div /></Section>
  }

  const rewards = describeRiderSocialRewards(data?.config)
  const pending = (data?.sent || []).filter((r) => r.status === 'pending').length
  const rewarded = (data?.sent || []).filter((r) => r.status === 'rewarded').length
  const received = data?.received

  return (
    <>
      <Section
        title="Refer friends"
        subtitle="Share your code. Rewards are added only after they finish their first ride — not when they sign up."
      >
        <div
          style={{
            marginTop: 4,
            padding: '16px 14px',
            borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(245,102,0,0.16), rgba(82,45,128,0.12))',
            border: '1px solid rgba(245,102,0,0.35)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#522D80', letterSpacing: 0.4 }}>YOUR CODE</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#F56600', letterSpacing: 1.5, marginTop: 4 }}>
            {data?.code || '—'}
          </div>
          {data?.code && (
            <div style={{ fontSize: 12, color: '#522D80', marginTop: 6, wordBreak: 'break-all' }}>
              {riderPromoShareUrl(data.code)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="pressable"
            disabled={!data?.code || shareBusy}
            onClick={onShare}
            style={{
              flex: 1,
              padding: '12px 10px',
              borderRadius: 14,
              fontWeight: 800,
              color: '#fff',
              background: 'linear-gradient(135deg, #F56600, #ff7a1a)',
              boxShadow: '0 4px 14px rgba(245,102,0,0.28)',
              opacity: !data?.code || shareBusy ? 0.7 : 1,
            }}
          >
            {shareBusy ? 'Sharing…' : 'Share'}
          </button>
          <button
            type="button"
            className="pressable"
            disabled={!data?.code}
            onClick={onCopy}
            style={{
              flex: 1,
              padding: '12px 10px',
              borderRadius: 14,
              fontWeight: 800,
              color: '#522D80',
              background: 'rgba(82,45,128,0.1)',
              border: '1px solid rgba(82,45,128,0.25)',
            }}
          >
            Copy link
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '12px 0 0', lineHeight: 1.45 }}>
          You get <strong style={{ color: '#522D80' }}>{rewards.referrer}</strong> when a friend
          completes their first ride. They get <strong style={{ color: '#F56600' }}>{rewards.referred}</strong>.
          A signup that never becomes a completed trip is not rewarded.
        </p>
        {note && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#522D80' }}>{note}</div>
        )}
        {data?.error && (
          <div style={{ fontSize: 13, marginTop: 10, color: 'var(--danger)' }}>{data.error}</div>
        )}
      </Section>

      <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
        <div style={{ fontWeight: 800, color: '#522D80' }}>Your stats</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {[
            ['Pending', pending],
            ['Rewarded', rewarded],
            ['Your credit', formatCents(data?.creditCents || 0)],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                flex: 1,
                padding: '10px 8px',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.55)',
                border: '1px solid rgba(82,45,128,0.12)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: '#F56600' }}>{value}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#522D80', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {received && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
            You signed up with <strong style={{ color: '#522D80' }}>{received.code}</strong> from {received.referrer_first_name}.{' '}
            {received.status === 'rewarded'
              ? (Number(received.referred_reward_cents) > 0
                ? `Rewarded ${formatCents(received.referred_reward_cents)} after your first ride.`
                : 'First ride completed. No rider-social credit — another referral reward was already used for this signup.')
              : 'Pending — your reward is issued after your first completed ride, not at signup.'}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          {(data?.sent || []).length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-tertiary)' }}>No friends have used your code yet.</div>
          )}
          {(data?.sent || []).map((row) => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 0',
                borderTop: '1px solid rgba(82,45,128,0.08)',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700, color: '#522D80' }}>{row.referred_first_name || 'Rider'}</span>
              <span style={{ color: row.status === 'rewarded' ? '#F56600' : 'var(--ink-tertiary)', fontWeight: 700 }}>
                {row.status === 'rewarded'
                  ? (Number(row.referrer_reward_cents) > 0
                    ? `Rewarded ${formatCents(row.referrer_reward_cents)}`
                    : 'Not paid')
                  : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {data?.isAdmin && (
        <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
          <div style={{ fontWeight: 800, color: '#522D80' }}>Admin</div>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '4px 0 8px', lineHeight: 1.45 }}>
            rider_social usage. First names only. SQL: select * from rider_social_referral_report
          </div>
          {data.adminReport.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-tertiary)' }}>No rider referrals yet.</div>
          )}
          {data.adminReport.map((row) => (
            <div
              key={row.id}
              style={{
                padding: '8px 0',
                borderTop: '1px solid rgba(82,45,128,0.08)',
                fontSize: 13,
                color: '#522D80',
              }}
            >
              <strong>{row.referrer_first_name || 'Rider'}</strong>
              {' → '}
              <strong>{row.referred_first_name || 'Rider'}</strong>
              {' · '}
              <span style={{ color: row.status === 'rewarded' ? '#F56600' : 'var(--ink-tertiary)', fontWeight: 700 }}>
                {row.status}
              </span>
              {row.status === 'rewarded' && (
                <span>
                  {' · '}
                  referrer {formatCents(row.referrer_reward_cents)}
                  {' · '}
                  new rider {formatCents(row.referred_reward_cents)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
