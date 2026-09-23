import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from './PrimaryButton'
import { IconCard } from './icons'
import { useAuth } from '../lib/auth'
import { createSetupIntent, savePaymentMethod } from '../lib/friendRides'
import { loadStripeJs } from '../lib/stripeElements'
import { getStripeConfig } from '../lib/stripeCheckout'
import { fetchMyRideBills } from '../lib/rideBills'
import { supabase } from '../lib/supabase'
import { pushToast } from '../lib/toasts'

const CARD_LS = (uid) => `clemson.card_display.${uid || 'anon'}`

function loadCardDisplay(uid) {
  try {
    return JSON.parse(localStorage.getItem(CARD_LS(uid)) || 'null')
  } catch {
    return null
  }
}

function saveCardDisplay(uid, info) {
  try {
    if (info) localStorage.setItem(CARD_LS(uid), JSON.stringify(info))
    else localStorage.removeItem(CARD_LS(uid))
  } catch {
    /* ignore */
  }
}

async function markBillingActivated(userId) {
  if (!supabase || !userId) return { softFail: null }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('profiles')
    .update({ billing_activated_at: now, updated_at: now })
    .eq('id', userId)
  if (error) return { softFail: error.message }
  return { softFail: null, at: now }
}

export function BillingPanel({ profile, onProfileRefresh }) {
  const { user } = useAuth()
  const mountRef = useRef(null)
  const elementsRef = useRef(null)
  const stripeRef = useRef(null)
  const [card, setCard] = useState(() => loadCardDisplay(user?.id))
  const [activatedAt, setActivatedAt] = useState(profile?.billing_activated_at || null)
  const [hasPm, setHasPm] = useState(Boolean(profile?.stripe_default_pm_id))
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [bills, setBills] = useState([])
  const [billsErr, setBillsErr] = useState(null)
  const { configured: stripeConfigured } = getStripeConfig()

  useEffect(() => {
    setHasPm(Boolean(profile?.stripe_default_pm_id))
    setActivatedAt(profile?.billing_activated_at || activatedAt)
    if (profile?.stripe_card_brand || profile?.stripe_card_last4) {
      const info = {
        brand: profile.stripe_card_brand || card?.brand,
        last4: profile.stripe_card_last4 || card?.last4,
      }
      setCard(info)
      saveCardDisplay(user?.id, info)
    }
  }, [profile, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    fetchMyRideBills(user.id, 10)
      .then((rows) => alive && setBills(rows || []))
      .catch((e) => alive && setBillsErr(e.message || 'Could not load ride bills'))
    return () => { alive = false }
  }, [user?.id])

  async function mountElements() {
    setErr(null)
    setMsg(null)
    setBusy(true)
    try {
      if (!stripeConfigured) throw new Error('Stripe publishable key not configured')
      const setup = await createSetupIntent()
      const stripe = await loadStripeJs()
      if (!stripe) throw new Error('Stripe.js failed to load')
      stripeRef.current = stripe

      if (setup.cardBrand || setup.cardLast4) {
        const info = { brand: setup.cardBrand, last4: setup.cardLast4 }
        setCard(info)
        saveCardDisplay(user?.id, info)
      }
      if (setup.hasDefaultPm) setHasPm(true)

      const elements = stripe.elements({
        clientSecret: setup.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#F56600',
            colorText: '#0B1220',
            borderRadius: '12px',
            fontFamily: 'Inter, system-ui, sans-serif',
          },
        },
      })
      elementsRef.current = elements
      const paymentElement = elements.create('payment', {
        layout: 'tabs',
      })
      // Clear previous mount
      if (mountRef.current) mountRef.current.innerHTML = ''
      paymentElement.mount(mountRef.current)
      setShowForm(true)
      setMsg('Add a card or Apple Pay (domain must be verified in Stripe).')
    } catch (e) {
      setErr(e.message || 'Could not start card setup')
      setShowForm(false)
    } finally {
      setBusy(false)
    }
  }

  async function onSaveCard() {
    if (!stripeRef.current || !elementsRef.current) {
      setErr('Card form not ready')
      return
    }
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const stripe = stripeRef.current
      const elements = elementsRef.current
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}${window.location.pathname}#/account`,
        },
      })
      if (error) throw new Error(error.message || 'Card confirmation failed')
      const setupIntentId = setupIntent?.id
      const paymentMethodId =
        typeof setupIntent?.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id

      const saved = await savePaymentMethod({ paymentMethodId, setupIntentId })
      const info = {
        brand: saved.brand || saved.cardBrand || card?.brand || 'card',
        last4: saved.last4 || saved.cardLast4 || card?.last4 || '••••',
      }
      setCard(info)
      saveCardDisplay(user?.id, info)
      setHasPm(true)

      const act = await markBillingActivated(user.id)
      if (act.at) setActivatedAt(act.at)
      if (act.softFail) {
        setMsg(`Card saved. billing_activated_at soft-fail: ${act.softFail}`)
      } else {
        setMsg('Account activated — card on file.')
      }
      setShowForm(false)
      pushToast({
        kind: 'fare_charged',
        title: 'Payment method saved',
        body: info.last4 ? `${String(info.brand || 'Card').toUpperCase()} ···· ${info.last4}` : 'Card on file',
        category: 'billing',
      })
      onProfileRefresh?.()
    } catch (e) {
      setErr(e.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const brandLabel = card?.brand ? String(card.brand).toUpperCase() : null

  return (
    <div>
      <div
        className="glass-panel"
        style={{
          padding: 16,
          borderRadius: 18,
          background: 'linear-gradient(145deg, rgba(255,255,255,0.7), rgba(82,45,128,0.08))',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(245,102,0,0.12)',
            }}
          >
            <IconCard size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Payment method</div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
              Saved card for friend rides & airport deposits
            </div>
          </div>
        </div>

        {hasPm || card?.last4 ? (
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(82,45,128,0.12)',
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
              {brandLabel || 'Card'} ···· {card?.last4 || 'saved'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>
              {activatedAt
                ? `Account activated ${new Date(activatedAt).toLocaleDateString()}`
                : hasPm
                  ? 'Card on file — tap Activate to confirm'
                  : 'Card details cached locally'}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12, lineHeight: 1.45 }}>
            No card on file yet. Add a payment method to activate your account for auto-charged friend rides.
          </div>
        )}

        {!showForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PrimaryButton onClick={mountElements} disabled={busy || !stripeConfigured}>
              {busy ? 'Loading…' : hasPm || card?.last4 ? 'Replace card' : 'Add card'}
            </PrimaryButton>
            {(hasPm || card?.last4) && !activatedAt && (
              <button
                type="button"
                className="pressable"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const act = await markBillingActivated(user.id)
                  setBusy(false)
                  if (act.at) {
                    setActivatedAt(act.at)
                    setMsg('Account activated')
                    onProfileRefresh?.()
                  } else {
                    setErr(act.softFail || 'Could not set billing_activated_at')
                  }
                }}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  fontWeight: 700,
                  color: 'var(--purple)',
                  border: '1.5px solid rgba(82,45,128,0.3)',
                  background: 'rgba(255,255,255,0.55)',
                }}
              >
                Activate account
              </button>
            )}
            {!stripeConfigured && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                VITE_STRIPE_PUBLISHABLE_KEY is not set — card form unavailable.
              </div>
            )}
          </div>
        ) : (
          <div>
            <div ref={mountRef} style={{ marginBottom: 12, minHeight: 80 }} />
            <PrimaryButton onClick={onSaveCard} disabled={busy}>
              {busy ? 'Saving…' : activatedAt || hasPm ? 'Save & replace' : 'Save card & activate'}
            </PrimaryButton>
            <button
              type="button"
              className="pressable"
              onClick={() => {
                setShowForm(false)
                if (mountRef.current) mountRef.current.innerHTML = ''
              }}
              style={{ display: 'block', width: '100%', marginTop: 10, fontWeight: 600, color: 'var(--ink-secondary)' }}
            >
              Cancel
            </button>
            <p style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 10, lineHeight: 1.4 }}>
              Apple Pay appears when the domain is verified in the Stripe Dashboard.
            </p>
          </div>
        )}

        {msg && (
          <div style={{ fontSize: 13, marginTop: 10, color: 'var(--success)', textAlign: 'center' }}>{msg}</div>
        )}
        {err && (
          <div style={{ fontSize: 13, marginTop: 10, color: 'var(--danger)', textAlign: 'center' }}>{err}</div>
        )}
      </div>

      <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
        <div style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 8 }}>Ride bills</div>
        {billsErr && (
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
            {/relation|does not exist|schema cache/i.test(billsErr)
              ? 'ride_bills not available yet.'
              : billsErr}
          </div>
        )}
        {!billsErr && bills.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)' }}>No ride bills yet.</div>
        )}
        {bills.map((b) => (
          <div
            key={b.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600 }}>{b.status || 'bill'}</span>
            <span style={{ color: 'var(--ink-secondary)' }}>
              {b.amount_cents != null
                ? (Number(b.amount_cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
