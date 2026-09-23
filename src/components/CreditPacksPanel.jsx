import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { buyCreditPack, confirmCreditPurchase, fetchCredits } from '../lib/billingApi'
import { getHashRoute } from '../lib/navigation'
import { CREDIT_PACKS } from '../lib/fareRates'
import { formatUsdFromCents } from '../lib/pricing'

/**
 * Buy prepaid ride credits. Sits under BillingPanel — does not replace card setup.
 * Discount % is the rate on the pack you buy, applied later when that lot is spent.
 */
export function CreditPacksPanel() {
  const { user } = useAuth()
  const [balance, setBalance] = useState(0)
  const [lots, setLots] = useState([])
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(null)

  async function reload() {
    const data = await fetchCredits()
    setBalance(data.balanceCents || 0)
    setLots(data.lots || [])
  }

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    const params = getHashRoute().params || {}
    ;(async () => {
      try {
        if (params.session_id && params.credits === '1') {
          await confirmCreditPurchase(params.session_id)
          if (alive) setMsg('Credits added to your balance.')
        }
        const data = await fetchCredits()
        if (!alive) return
        setBalance(data.balanceCents || 0)
        setLots(data.lots || [])
      } catch (e) {
        if (alive) setErr(e.message || 'Could not load credits')
      }
    })()
    return () => { alive = false }
  }, [user?.id])

  async function onBuy(packId) {
    setBusy(packId)
    setErr(null)
    setMsg(null)
    try {
      const session = await buyCreditPack(packId)
      if (session.url) {
        window.location.href = session.url
        return
      }
      setErr('Checkout did not return a payment URL.')
    } catch (e) {
      setErr(e.message || 'Could not start checkout')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Ride credits</div>
      <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 2, marginBottom: 10 }}>
        Prepay a pack. The discount on that pack applies when those credits pay for a ride.
        Platform keeps 20% of the discounted fare; your driver keeps 80%.
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.4 }}>
        {formatUsdFromCents(balance)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 12 }}>Available balance</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CREDIT_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className="pressable"
            disabled={Boolean(busy)}
            onClick={() => onBuy(pack.id)}
            style={{
              textAlign: 'left',
              padding: '12px 14px',
              borderRadius: 14,
              border: '1px solid rgba(82,45,128,0.16)',
              background: 'rgba(255,255,255,0.65)',
            }}
          >
            <div style={{ fontWeight: 800 }}>{pack.label}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 2 }}>
              {busy === pack.id ? 'Opening checkout…' : `Load ${formatUsdFromCents(pack.loadCents)} · ${pack.discountBps / 100}% off rides paid with this pack`}
            </div>
          </button>
        ))}
      </div>

      {lots.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-secondary)' }}>
          {lots.map((lot) => (
            <div key={lot.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>{lot.discountBps / 100}% pack</span>
              <span>{formatUsdFromCents(lot.remainingCents)} left</span>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="pressable" onClick={() => reload().catch((e) => setErr(e.message))}
        style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
        Refresh balance
      </button>
      {msg && <div style={{ fontSize: 13, marginTop: 8, color: 'var(--success)' }}>{msg}</div>}
      {err && <div style={{ fontSize: 13, marginTop: 8, color: 'var(--danger)' }}>{err}</div>}
    </div>
  )
}
