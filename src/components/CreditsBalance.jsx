import { useEffect, useState } from 'react'
import { fetchCredits } from '../lib/payments'
import { formatUsdCents, prepaidCreditsFromPayload } from '../../shared/prepaidTiers.js'

export function CreditsBalance({ refreshToken = 0 }) {
  const [balanceCents, setBalanceCents] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchCredits()
      .then((data) => {
        if (!alive) return
        const parsed = prepaidCreditsFromPayload(data)
        setBalanceCents(parsed.balanceCents)
        setUnavailable(parsed.unavailable)
        setNote(null)
      })
      .catch((err) => {
        if (!alive) return
        setBalanceCents(null)
        setUnavailable(true)
        setNote(err.message || 'Could not load credits')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [refreshToken])

  const amount = loading
    ? '…'
    : unavailable || balanceCents == null
      ? 'Balance unavailable'
      : formatUsdCents(balanceCents)

  return (
    <div
      className="glass-panel"
      data-testid="credits-balance"
      style={{ marginBottom: 14, padding: 16, borderRadius: 18 }}
    >
      <div data-testid="credits-label" style={{ fontWeight: 800, color: 'var(--purple)', fontSize: 13 }}>
        credits
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.4, color: 'var(--ink)', marginTop: 4 }}>
        {amount}
      </div>
      {note && <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>{note}</div>}
    </div>
  )
}
