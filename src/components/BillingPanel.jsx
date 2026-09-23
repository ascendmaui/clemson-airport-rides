import { useCallback, useEffect, useRef, useState } from 'react'
import { PrimaryButton } from './PrimaryButton'
import { IconCard } from './icons'
import { useAuth } from '../lib/auth'
import {
  createSetupIntent, savePaymentMethod, listPaymentMethods, updatePaymentMethod,
} from '../lib/friendRides'
import { loadStripeJs, PAYMENT_ELEMENT_APPEARANCE } from '../lib/stripeElements'
import { stripeMountNode } from '../lib/stripeMountTarget'
import { getStripeConfig } from '../lib/stripeCheckout'
import { fetchMyRideBills } from '../lib/rideBills'
import { getHashRoute } from '../lib/navigation'
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

function billingPurpose(role) {
  if (role === 'driver') {
    return 'Card on file when a ride charges your driver account. Friend-ride shares use this default card.'
  }
  if (role === 'both') {
    return 'Default card for rider fares, airport deposits, and charges to your driver account.'
  }
  return 'Default card for friend rides and airport deposits.'
}

function roleLabel(role) {
  if (role === 'driver') return 'Driver'
  if (role === 'both') return 'Rider & driver'
  return 'Rider'
}

function redirectSetupParams() {
  const hashParams = getHashRoute().params || {}
  const search = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()
  return {
    setupIntentId: hashParams.setup_intent || search.get('setup_intent') || '',
    status: hashParams.redirect_status || search.get('redirect_status') || '',
  }
}

function clearSetupRedirect() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('setup_intent')
  url.searchParams.delete('setup_intent_client_secret')
  url.searchParams.delete('redirect_status')
  url.hash = '#/account?tab=billing'
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(null, '', next)
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
  const stripeRef = useRef(null)
  const elementsRef = useRef(null)
  const paymentElementRef = useRef(null)
  const redirectHandled = useRef(false)
  const [mountNode, setMountNode] = useState(null)
  const [card, setCard] = useState(() => loadCardDisplay(user?.id))
  const [activatedAt, setActivatedAt] = useState(profile?.billing_activated_at || null)
  const [hasPm, setHasPm] = useState(Boolean(profile?.stripe_default_pm_id))
  const [methods, setMethods] = useState([])
  const [defaultPmId, setDefaultPmId] = useState(profile?.stripe_default_pm_id || null)
  const [showForm, setShowForm] = useState(false)
  const [clientSecret, setClientSecret] = useState(null)
  const [formReady, setFormReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [bills, setBills] = useState([])
  const [billsErr, setBillsErr] = useState(null)
  const [listTick, setListTick] = useState(0)
  const { configured: stripeConfigured } = getStripeConfig()
  const onMountNode = useCallback((node) => {
    setMountNode(node)
  }, [])

  function rememberCard(info) {
    if (info?.last4 || info?.brand) {
      setCard(info)
      saveCardDisplay(user?.id, info)
      return
    }
    setCard(null)
    saveCardDisplay(user?.id, null)
  }

  function applySaved(saved) {
    const info = {
      brand: saved.brand || saved.cardBrand || card?.brand || 'card',
      last4: saved.last4 || saved.cardLast4 || card?.last4 || null,
    }
    if (info.last4) rememberCard(info)
    setHasPm(true)
    if (saved.paymentMethodId) setDefaultPmId(saved.paymentMethodId)
    if (saved.billingActivatedAt) setActivatedAt(saved.billingActivatedAt)
    setListTick((n) => n + 1)
    pushToast({
      kind: 'fare_charged',
      title: 'Payment method saved',
      body: info.last4 ? `${String(info.brand || 'Card').toUpperCase()} ···· ${info.last4}` : 'Card on file',
      category: 'billing',
    })
  }

  useEffect(() => {
    setHasPm(Boolean(profile?.stripe_default_pm_id))
    if (profile?.stripe_default_pm_id) setDefaultPmId(profile.stripe_default_pm_id)
    if (profile?.billing_activated_at) setActivatedAt(profile.billing_activated_at)
    if (profile?.stripe_card_brand || profile?.stripe_card_last4) {
      rememberCard({
        brand: profile.stripe_card_brand || null,
        last4: profile.stripe_card_last4 || null,
      })
    }
  }, [
    profile?.stripe_default_pm_id,
    profile?.billing_activated_at,
    profile?.stripe_card_brand,
    profile?.stripe_card_last4,
    user?.id,
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    fetchMyRideBills(user.id, 10)
      .then((rows) => alive && setBills(rows || []))
      .catch((e) => alive && setBillsErr(e.message || 'Could not load ride bills'))
    return () => { alive = false }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    listPaymentMethods()
      .then((data) => {
        if (!alive) return
        const rows = data?.methods || []
        setMethods(rows)
        const nextDefault = data?.defaultPmId || null
        if (nextDefault) setDefaultPmId(nextDefault)
        setHasPm(Boolean(nextDefault) || rows.length > 0)
        const current = rows.find((m) => m.id === nextDefault) || rows[0]
        if (current?.last4 || current?.brand) {
          rememberCard({ brand: current.brand, last4: current.last4 })
        }
      })
      .catch(() => {
        /* Profile fields still show the saved card when the list route is down. */
      })
    return () => { alive = false }
  }, [user?.id, listTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id || redirectHandled.current) return undefined
    const { setupIntentId, status } = redirectSetupParams()
    if (!setupIntentId) return undefined
    redirectHandled.current = true
    if (status && status !== 'succeeded') {
      setErr('Card setup did not finish. Add the card again.')
      clearSetupRedirect()
      return undefined
    }
    let alive = true
    ;(async () => {
      setBusy(true)
      setErr(null)
      try {
        const saved = await savePaymentMethod({ setupIntentId })
        if (!alive) return
        applySaved(saved)
        const act = await markBillingActivated(user.id)
        if (act.at) setActivatedAt(act.at)
        setMsg(act.softFail
          ? `Card saved. billing_activated_at soft-fail: ${act.softFail}`
          : 'Account activated — card on file.')
        clearSetupRedirect()
        onProfileRefresh?.()
      } catch (e) {
        if (alive) setErr(e.message || 'Could not save card after redirect')
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => { alive = false }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the SetupIntent only after the form is open. Mount happens in the next effect.
  useEffect(() => {
    if (!showForm) return undefined
    let cancelled = false
    setBusy(true)
    setErr(null)
    setFormReady(false)
    ;(async () => {
      try {
        if (!stripeConfigured) throw new Error('Stripe publishable key not configured')
        const setup = await createSetupIntent()
        if (cancelled) return
        if (!setup?.clientSecret) throw new Error('SetupIntent did not return a client secret')
        if (setup.cardBrand || setup.cardLast4) {
          rememberCard({ brand: setup.cardBrand, last4: setup.cardLast4 })
        }
        if (setup.hasDefaultPm) setHasPm(true)
        setClientSecret(setup.clientSecret)
      } catch (e) {
        if (cancelled) return
        setClientSecret(null)
        setShowForm(false)
        setErr(e.message || 'Could not start card setup')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
      setBusy(false)
    }
  }, [showForm, stripeConfigured]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mount only once the container ref is a connected element. Unmount on close / secret change.
  useEffect(() => {
    const node = stripeMountNode(mountNode)
    if (!showForm || !clientSecret || !node) return undefined
    let cancelled = false
    let paymentElement = null
    let slowTimer = 0

    ;(async () => {
      try {
        const stripe = await loadStripeJs()
        if (cancelled) return
        const target = stripeMountNode(mountNode)
        if (!target) return
        stripeRef.current = stripe
        const elements = stripe.elements({
          clientSecret,
          appearance: PAYMENT_ELEMENT_APPEARANCE,
        })
        paymentElement = elements.create('payment', { layout: 'tabs' })
        paymentElement.on('ready', () => {
          window.clearTimeout(slowTimer)
          if (!cancelled) {
            setFormReady(true)
            setErr((prev) => (prev && /did not finish loading/i.test(prev) ? null : prev))
          }
        })
        paymentElement.on('loaderror', (event) => {
          if (!cancelled) setErr(event?.error?.message || 'Card form failed to load')
        })
        if (cancelled) return
        paymentElement.mount(target)
        if (cancelled) {
          try { paymentElement.unmount() } catch { /* already gone */ }
          return
        }
        slowTimer = window.setTimeout(() => {
          if (!cancelled) setErr('Card form did not finish loading. Close it and try Add card again.')
        }, 15000)
        elementsRef.current = elements
        paymentElementRef.current = paymentElement
      } catch (e) {
        if (!cancelled) {
          setFormReady(false)
          setErr(e.message || 'Could not mount card form')
        }
      }
    })()

    return () => {
      cancelled = true
      setFormReady(false)
      window.clearTimeout(slowTimer)
      const pe = paymentElement || paymentElementRef.current
      paymentElementRef.current = null
      elementsRef.current = null
      if (pe) {
        try { pe.unmount() } catch { /* already unmounted */ }
      }
    }
  }, [showForm, clientSecret, mountNode])

  function openCardForm() {
    setErr(null)
    setMsg(null)
    setFormReady(false)
    setClientSecret(null)
    setShowForm(true)
  }

  function closeCardForm() {
    setShowForm(false)
    setClientSecret(null)
    setFormReady(false)
    setMountNode(null)
  }

  async function onSaveCard() {
    if (!stripeRef.current || !elementsRef.current || !formReady) {
      setErr('Card form is still loading')
      return
    }
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const { error, setupIntent } = await stripeRef.current.confirmSetup({
        elements: elementsRef.current,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}${window.location.pathname}#/account?tab=billing`,
        },
      })
      if (error) throw new Error(error.message || 'Card confirmation failed')
      const setupIntentId = setupIntent?.id
      const paymentMethodId =
        typeof setupIntent?.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id

      const saved = await savePaymentMethod({ paymentMethodId, setupIntentId })
      applySaved(saved)
      const act = await markBillingActivated(user.id)
      if (act.at) setActivatedAt(act.at)
      if (act.softFail) {
        setMsg(`Card saved. billing_activated_at soft-fail: ${act.softFail}`)
      } else {
        setMsg('Account activated — card on file.')
      }
      closeCardForm()
      onProfileRefresh?.()
    } catch (e) {
      setErr(e.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function onUseCard(paymentMethodId) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const saved = await updatePaymentMethod({ action: 'default', paymentMethodId })
      setDefaultPmId(saved.defaultPmId || paymentMethodId)
      setMethods(saved.methods || methods)
      setHasPm(true)
      if (saved.last4 || saved.brand) rememberCard({ brand: saved.brand, last4: saved.last4 })
      setMsg('This card will be charged for ride fares.')
      onProfileRefresh?.()
    } catch (e) {
      setErr(e.message || 'Could not set default card')
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveCard(paymentMethodId) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const saved = await updatePaymentMethod({ action: 'detach', paymentMethodId })
      const rows = saved.methods || []
      setMethods(rows)
      setDefaultPmId(saved.defaultPmId || null)
      setHasPm(Boolean(saved.defaultPmId) || rows.length > 0)
      if (saved.last4 || saved.brand) rememberCard({ brand: saved.brand, last4: saved.last4 })
      else if (!rows.length) rememberCard(null)
      setMsg(rows.length ? 'Card removed.' : 'No card on file.')
      onProfileRefresh?.()
    } catch (e) {
      setErr(e.message || 'Could not remove card')
    } finally {
      setBusy(false)
    }
  }

  const brandLabel = card?.brand ? String(card.brand).toUpperCase() : null
  const showSavedSummary = !methods.length && (hasPm || card?.last4)

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
            <div style={{ fontWeight: 800, color: 'var(--purple)' }}>
              Payment method
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--orange)' }}>
                {roleLabel(profile?.role)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
              {billingPurpose(profile?.role)}
            </div>
          </div>
        </div>

        {methods.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {methods.map((m) => {
              const inUse = m.id === defaultPmId
              const label = `${String(m.brand || 'Card').toUpperCase()} ···· ${m.last4 || 'saved'}`
              return (
                <div
                  key={m.id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.65)',
                    border: inUse ? '1.5px solid rgba(245,102,0,0.55)' : '1px solid rgba(82,45,128,0.12)',
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>
                    {inUse ? 'Used for ride charges' : 'Saved on your Stripe customer'}
                    {activatedAt && inUse ? ` · activated ${new Date(activatedAt).toLocaleDateString()}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {!inUse && (
                      <button
                        type="button"
                        className="pressable"
                        disabled={busy}
                        onClick={() => onUseCard(m.id)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 12,
                          fontWeight: 700,
                          color: '#fff',
                          background: 'linear-gradient(135deg, var(--orange), #ff7a1a)',
                        }}
                      >
                        Use this card
                      </button>
                    )}
                    <button
                      type="button"
                      className="pressable"
                      disabled={busy}
                      onClick={() => onRemoveCard(m.id)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 12,
                        fontWeight: 700,
                        color: 'var(--ink-secondary)',
                        border: '1px solid rgba(82,45,128,0.18)',
                        background: 'rgba(255,255,255,0.7)',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showSavedSummary && (
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
                : 'Card on file — used for ride charges'}
            </div>
          </div>
        )}

        {!showSavedSummary && methods.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12, lineHeight: 1.45 }}>
            No card on file yet. Add a payment method to activate your account for auto-charged friend rides.
          </div>
        )}

        {!showForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PrimaryButton onClick={openCardForm} disabled={busy || !stripeConfigured} data-testid="add-card">
              {busy ? 'Loading…' : 'Add card'}
            </PrimaryButton>
            {(hasPm || card?.last4 || methods.length > 0) && !activatedAt && (
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
            <div
              ref={onMountNode}
              data-testid="stripe-payment-mount"
              style={{ marginBottom: 12, minHeight: 80 }}
            />
            {!formReady && !err && (
              <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 10 }}>
                {busy ? 'Preparing secure card form…' : 'Loading card form…'}
              </div>
            )}
            <PrimaryButton onClick={onSaveCard} disabled={busy || !formReady} data-testid="save-card">
              {busy ? 'Saving…' : activatedAt || hasPm ? 'Save & replace' : 'Save card & activate'}
            </PrimaryButton>
            <button
              type="button"
              className="pressable"
              onClick={closeCardForm}
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
