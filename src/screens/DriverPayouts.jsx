import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { navigate } from '../lib/navigation'
import { cashOutPayout, loadPayoutDesk, startPayoutSetup } from '../../packages/rides-native/driverPayoutsClient.js'
import { payoutChipLabel } from '../../shared/driverPayoutMethods.js'
import { CASHOUT_COPY } from '../../shared/cashout.js'

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`
}

export function DriverPayouts() {
  const { user, loading: authLoading } = useAuth()
  const [desk, setDesk] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    if (authLoading || !user?.id) return undefined
    let alive = true
    loadPayoutDesk(supabase)
      .then((next) => { if (alive) setDesk(next) })
      .catch((err) => { if (alive) setError(err.message || 'Could not load payout methods') })
    return () => { alive = false }
  }, [authLoading, user])

  async function setup() {
    setBusy('setup')
    setError(null)
    try {
      const started = desk?.setupUrl ? { url: desk.setupUrl } : await startPayoutSetup(supabase)
      if (started?.url) window.location.assign(started.url)
      else setError('Stripe did not return a setup link')
    } catch (err) {
      setError(err.message || 'Could not open Stripe')
    } finally {
      setBusy(null)
    }
  }

  async function cashOut(method) {
    const quote = method === 'instant' ? desk?.instant : desk?.standard
    if (!quote || quote.state !== 'ready') return
    const fee = method === 'instant' ? `Instant fee ${money(quote.feeCents)}.` : 'Standard (free, 1-2 days).'
    const ok = window.confirm(`${fee} You get ${money(quote.netCents)}. One cash-out per day.`)
    if (!ok) return
    setBusy(method)
    setError(null)
    try {
      const result = await cashOutPayout(supabase, { method, feeCents: quote.feeCents || 0 })
      if (result?.ok) setNote(method === 'instant' ? 'Instant cash out sent.' : 'Standard cash out sent.')
      else setError(CASHOUT_COPY[result?.error] || 'Cash out was not sent.')
    } catch (err) {
      setError(err.message || 'Cash out was not sent.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ minHeight: '100%', overflowY: 'auto', background: 'linear-gradient(180deg, rgba(245,102,0,0.1), rgba(82,45,128,0.06) 32%, #f7f5f8)' }} data-testid="payout-methods">
      <div style={{ padding: '18px 18px 28px', maxWidth: 560, margin: '0 auto' }}>
        <button type="button" className="pressable" onClick={() => navigate('earnings')} style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 14 }}>
          ← Earnings
        </button>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>Money</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--purple)', marginTop: 2 }}>Payout methods</h1>
        {error ? <p role="alert" className="field-error-text">{error}</p> : null}
        {note ? <p style={{ fontWeight: 700, color: 'var(--purple)' }}>{note}</p> : null}
        <section className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>Available balance</div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{money(desk?.availableCents)}</div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }}>Pending balance</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{money(desk?.pendingCents)}</div>
        </section>
        <section className="glass-panel" style={{ marginTop: 12, padding: 16, borderRadius: 22 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>Cash out</h2>
          <button type="button" className="pressable" disabled={busy || desk?.instant?.state !== 'ready'} onClick={() => cashOut('instant')} style={{ marginTop: 8, fontWeight: 800 }}>
            Instant cash out
          </button>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
            {desk?.instant?.state === 'ready' ? `Instant fee ${money(desk.instant.feeCents)}.` : 'Instant cash out uses a linked debit card or bank. The fee is shown before you confirm.'}
          </p>
          <button type="button" className="pressable" disabled={busy || desk?.standard?.state !== 'ready'} onClick={() => cashOut('standard')} style={{ fontWeight: 800 }}>
            Standard (free, 1-2 days)
          </button>
        </section>
        <section className="glass-panel" style={{ marginTop: 12, padding: 16, borderRadius: 22 }} data-testid="linked-accounts">
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>Linked accounts</h2>
          {(desk?.methods || []).length === 0 ? <p style={{ color: 'var(--ink-secondary)' }}>No bank or debit card on file yet.</p> : null}
          {(desk?.methods || []).map((method) => (
            <p key={method.id || `${method.kind}-${method.last4}`} style={{ fontWeight: 700 }}>
              {method.kind === 'card' ? 'Debit card' : 'Bank'} · •••• {method.last4 || '····'}{method.default ? ' · Default' : ''}
            </p>
          ))}
          <button type="button" className="pressable" onClick={setup} disabled={Boolean(busy)} style={{ fontWeight: 800, color: 'var(--purple)' }}>
            {desk?.stripeConnect ? 'Add bank account' : 'Set up direct deposit'}
          </button>
          {desk?.dashboardUrl ? (
            <a href={desk.dashboardUrl} style={{ display: 'inline-block', marginTop: 8, fontWeight: 800, color: 'var(--purple)' }}>
              Manage or remove in Stripe
            </a>
          ) : null}
        </section>
        <section className="glass-panel" style={{ marginTop: 12, padding: 16, borderRadius: 22 }} data-testid="payout-history">
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>Payout history</h2>
          {(desk?.history || []).length === 0 ? <p style={{ color: 'var(--ink-secondary)' }}>Payouts show up here after Stripe sends them.</p> : null}
          {(desk?.history || []).map((row) => (
            <p key={row.id} style={{ fontWeight: 700 }}>
              {money(row.amountCents)} · {payoutChipLabel(row.status)}
            </p>
          ))}
        </section>
      </div>
    </div>
  )
}
