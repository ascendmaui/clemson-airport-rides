#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { isE2ETestEmail } from '../shared/e2eTestAccounts.js'
import { acceptTrip, advanceTrip } from '../packages/rides-native/driverDesk.js'

/** Small dotenv subset: literal KEY=VALUE, optional export/quotes/comments, no expansion. */
export function parseEnvFile(source) {
  const values = {}
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    let value = match[2]
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0], 1)
      if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) continue
      value = value.slice(1, end)
    } else value = value.replace(/\s+#.*$/, '').trim()
    Object.defineProperty(values, match[1], { value, enumerable: true, configurable: true, writable: true })
  }
  return values
}

export function assertE2EGuard(args, env) {
  if (!args.includes('--confirm-prod-e2e')) throw new Error('Requires --confirm-prod-e2e (including --dry-check)')
  if (!isE2ETestEmail(env.E2E_RIDER_EMAIL) || !isE2ETestEmail(env.E2E_DRIVER_EMAIL)) {
    throw new Error('Both emails must be reserved e2e+ accounts at clemsonrides.com')
  }
}

/** Only a test key AND a successful, explicitly non-live retrieval allow money steps. */
export function decideStripeMode(publishableKey, setupIntent, retrievalError = null) {
  return !retrievalError && publishableKey?.startsWith('pk_test_') && setupIntent?.livemode === false
    ? 'test' : 'live'
}

/** A failed hold can only be bypassed for an explicitly marked, created test trip. */
export function shouldContinueWithoutHold({ flag, stripeMode, tripCreated, e2eFlag }) {
  return flag === true && stripeMode === 'test' && tripCreated === true && e2eFlag === true
}

/** Only diagnostic fields; never dump response bodies that may contain credentials. */
export function errorDetail(result) {
  if (!result) return ''
  if (typeof result === 'string') return result
  return [...new Set([
    result.message, result.code,
    typeof result.error === 'string' ? result.error : result.error?.message,
    result.error?.code, result.failure?.message, result.failure?.code,
  ].filter(value => typeof value === 'string' && value))].join('; ')
}

function failureDetail(message, ...results) {
  const details = results.map(errorDetail).filter(Boolean)
  return [message, ...details].join(': ')
}

const ride = {
  tier: 'standard', pickupLabel: 'Clemson University - Cooper Library',
  pickupLat: 34.6766, pickupLng: -82.8364,
  dest: 'Clemson Downtown', destLat: 34.6834, destLng: -82.8374,
}
const NOTE = 'E2E TEST - automated harness'
const rideSteps = ['card', 'driver_online', 'quote', 'book', 'offer', 'accept', 'en_route', 'pickup',
  'in_progress', 'complete', 'capture', 'tip', 'payout_ledger']

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

export async function main(args = process.argv.slice(2)) {
  const summary = { steps: [], tripId: null, stripeMode: null, sha: null, capturePayoutExercised: false }
  let env = { ...process.env }
  let signal = null
  let rider, driver, riderId, driverId, setup, settle
  let continuedWithoutHold = false
  let lastHttpFailure = null
  let onlineTouched = false
  let bookingAttempted = false
  const dryCheck = args.includes('--dry-check')
  const startedAt = new Date().toISOString()
  const originalFetch = globalThis.fetch
  const oldApiBase = process.env.EXPO_PUBLIC_API_BASE
  const secrets = new Set(Object.entries(env).filter(([key]) => /PASSWORD|TOKEN|KEY|SECRET/.test(key)).map(([, value]) => value))

  function safeDetail(raw) {
    let text = String(raw || '').replace(/[\r\n]+/g, ' ')
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
    return text.replace(/\b(?:pk|sk)_(?:test|live)_\S+/g, '[redacted key]')
      .replace(/\b\w+_secret_\S+/g, '[redacted client secret]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted token]').slice(0, 500)
  }
  function record(name, status, detail) {
    const row = { name, status, detail: safeDetail(detail) }
    summary.steps.push(row)
    console.log(`STEP ${name} ${status} ${row.detail}`)
  }
  async function step(name, fn, continueOnFailure = () => false) {
    lastHttpFailure = null
    signal = AbortSignal.timeout(30_000)
    try {
      const detail = await fn()
      signal.throwIfAborted()
      record(name, 'PASS', detail)
    } catch (error) {
      record(name, 'FAIL', failureDetail(signal.aborted ? `step timed out after 30s: ${error.message}` : error.message, lastHttpFailure))
      if (signal.aborted || !continueOnFailure()) throw error
    } finally { signal = null }
  }
  // All HTTP, Supabase and imported driverDesk requests share the current step deadline.
  // Aborting the actual requests prevents a timed-out mutation from continuing in the background.
  async function boundedFetch(url, options = {}) {
    signal?.throwIfAborted()
    const signals = [signal, options.signal].filter(Boolean)
    const response = await originalFetch(url, { ...options, redirect: 'error',
      signal: signals.length ? AbortSignal.any(signals) : AbortSignal.timeout(30_000) })
    // Also retain raw HTTP diagnostics for requests made by driverDesk, whose UI
    // error helpers may otherwise replace the server's message with friendly copy.
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null)
      lastHttpFailure = failureDetail(`HTTP ${response.status}`, body)
    }
    return response
  }
  async function api(client, path, body) {
    const session = client ? await client.auth.getSession() : null
    const token = session?.data?.session?.access_token
    if (client) requireThat(token, 'Session unavailable')
    secrets.add(token)
    const response = await boundedFetch(`${env.E2E_BASE_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const bodyResult = await response.json().catch(() => null)
    requireThat(response.ok, failureDetail(`${path}: HTTP ${response.status}`, bodyResult))
    return bodyResult
  }
  async function stripeRequest(path, fields, method = 'GET') {
    const response = await boundedFetch(`https://api.stripe.com/v1/${path}${method === 'GET' ? `?${new URLSearchParams(fields)}` : ''}`, {
      method, headers: { Authorization: `Bearer ${env.STRIPE_PUBLISHABLE_KEY}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? new URLSearchParams(fields) : undefined,
    })
    const bodyResult = await response.json().catch(() => null)
    requireThat(response.ok, failureDetail(`Stripe request: HTTP ${response.status}`, bodyResult))
    return bodyResult
  }
  async function retryRead(fn) {
    let error
    for (let i = 0; i < 3; i++) {
      signal?.throwIfAborted()
      try { return await fn() } catch (err) { error = err }
      if (i < 2) await delay(500, undefined, { signal })
    }
    throw error
  }
  async function readTrip(client = driver) {
    return retryRead(async () => {
      const result = await client.from('trips').select('*').eq('id', summary.tripId).maybeSingle()
      requireThat(!result.error && result.data, failureDetail('Trip unreadable or not yet visible', result.error))
      return result.data
    })
  }
  async function presence(online, lat = ride.pickupLat, lng = ride.pickupLng) {
    const at = new Date().toISOString()
    const result = await driver.from('driver_status').upsert({ driver_id: driverId, online, lat, lng,
      updated_at: at, location_updated_at: at }, { onConflict: 'driver_id' })
    requireThat(!result.error, failureDetail(`Could not set driver ${online ? 'online' : 'offline'}`, result.error))
    const check = await driver.from('driver_status').select('online').eq('driver_id', driverId).maybeSingle()
    requireThat(!check.error && check.data?.online === online, failureDetail('Driver presence did not persist', check.error))
  }
  async function advance(expected) {
    const result = await advanceTrip(driver, await readTrip(), driverId)
    requireThat(result.status === expected, failureDetail(`Expected ${expected}; got ${result.status}`, result))
    if (result.settle) settle = result.settle
    const stored = await readTrip()
    requireThat(stored.status === expected, `Stored status is not ${expected}`)
    if (expected === 'arrived') requireThat(stored.arrived_at, 'Arrival endpoint did not stamp arrived_at')
    return `trip ${summary.tripId}: ${expected}`
  }

  try {
    await step('safety', async () => {
      const filename = env.E2E_ENV_FILE || `${homedir()}/.config/clemson-e2e/env`
      try { env = { ...parseEnvFile(await readFile(filename, 'utf8')), ...env } }
      catch (error) { if (error.code !== 'ENOENT' || env.E2E_ENV_FILE) throw new Error(failureDetail('Cannot read E2E env file', error)) }
      for (const [key, value] of Object.entries(env)) {
        if (/PASSWORD|TOKEN|KEY|SECRET/.test(key)) secrets.add(value)
      }
      assertE2EGuard(args, env)
      for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'STRIPE_PUBLISHABLE_KEY', 'E2E_RIDER_PASSWORD', 'E2E_DRIVER_PASSWORD']) {
        requireThat(env[key], `Missing ${key}`)
      }
      requireThat(/^pk_(test|live)_/.test(env.STRIPE_PUBLISHABLE_KEY), 'Requires a Stripe publishable key')
      env.E2E_BASE_URL = (env.E2E_BASE_URL || 'https://clemsonrides.com').replace(/\/+$/, '')
      for (const value of [env.E2E_BASE_URL, env.SUPABASE_URL]) {
        const url = new URL(value)
        requireThat(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
          'Requires an HTTP(S) origin without credentials, query or fragment')
      }
      process.env.EXPO_PUBLIC_API_BASE = env.E2E_BASE_URL
      globalThis.fetch = boundedFetch
      return 'reserved accounts and explicit flag verified'
    })
    if (dryCheck) record('healthz', 'SKIP', 'dry-check: sign-in and Stripe mode only')
    else await step('healthz', async () => {
      const health = await api(null, '/api/healthz')
      summary.sha = health.sha || health.gitSha || health.commit || null
      return `sha ${summary.sha || 'not exposed'}`
    })
    await step('signin', async () => {
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: boundedFetch } }
      rider = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, options)
      driver = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, options)
      for (const [client, role] of [[rider, 'RIDER'], [driver, 'DRIVER']]) {
        const result = await client.auth.signInWithPassword({ email: env[`E2E_${role}_EMAIL`], password: env[`E2E_${role}_PASSWORD`] })
        requireThat(!result.error && result.data?.session && isE2ETestEmail(result.data.user?.email), failureDetail(`${role.toLowerCase()} sign-in failed`, result.error))
        secrets.add(result.data.session.access_token)
        secrets.add(result.data.session.refresh_token)
        if (role === 'RIDER') riderId = result.data.user.id
        else driverId = result.data.user.id
      }
      requireThat(riderId !== driverId, 'Rider and driver must be different accounts')
      return 'separate rider and driver sessions established'
    })
    await step('stripe_mode', async () => {
      setup = await api(rider, '/api/stripe-setup-intent', {})
      requireThat(/^seti_[A-Za-z0-9]+$/.test(setup.setupIntentId) && setup.clientSecret, failureDetail('SetupIntent response missing id/client secret', setup))
      secrets.add(setup.clientSecret)
      let retrieved, retrievalError
      try { retrieved = await stripeRequest(`setup_intents/${setup.setupIntentId}`, { client_secret: setup.clientSecret }) }
      catch (error) { retrievalError = error }
      summary.stripeMode = decideStripeMode(env.STRIPE_PUBLISHABLE_KEY, retrieved, retrievalError)
      return `${summary.stripeMode}; key prefix ${env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_live_') ? 'pk_live_' : 'pk_test_'}${retrievalError ? `; retrieval failed, treated as live: ${retrievalError.message}` : ''}`
    })
    if (dryCheck || summary.stripeMode === 'live') {
      summary.note = dryCheck ? 'Dry check only; capture/payout not exercised' : 'Live or uncertain Stripe; capture/payout not exercised'
      for (const name of rideSteps) record(name, 'SKIP', name === 'book' && summary.stripeMode === 'live'
        ? 'live Stripe: refusing to place a real hold' : summary.note)
    } else {
      await step('card', async () => {
        const profile = await rider.from('profiles').select('stripe_default_pm_id').eq('id', riderId).maybeSingle()
        if (!profile.error && profile.data?.stripe_default_pm_id) return 'saved default card present'
        const confirmed = await stripeRequest(`setup_intents/${setup.setupIntentId}/confirm`, {
          client_secret: setup.clientSecret, payment_method: 'pm_card_visa',
        }, 'POST')
        requireThat(confirmed.status === 'succeeded', failureDetail(`Test card SetupIntent did not succeed; status ${confirmed.status}`, confirmed))
        const saved = await api(rider, '/api/stripe-save-payment-method', { setupIntentId: setup.setupIntentId })
        requireThat(saved.ok === true, failureDetail('Default test card was not saved', saved))
        return 'pm_card_visa confirmed and saved'
      })
      await step('driver_online', async () => {
        onlineTouched = true
        await presence(true)
        return 'test driver online near Cooper Library'
      })
      await step('quote', async () => {
        const quote = await api(rider, '/api/quote-fare', ride)
        requireThat(Number.isFinite(quote.fareCents) && quote.fareCents > 0, failureDetail('Quote has no positive fare', quote))
        summary.fareCents = quote.fareCents
        return `Standard fare ${quote.fareCents} cents`
      })
      await step('book', async () => {
        bookingAttempted = true // Never retry a booking; cleanup recovers a lost response.
        const booked = await api(rider, '/api/stripe-payment-methods?action=request-driver', {
          ...ride, driverId, note: NOTE,
        })
        summary.tripId = booked.trip?.id || null
        requireThat(summary.tripId && booked.trip.status === 'searching', failureDetail('Booking did not return a searching trip', booked))
        const trip = await readTrip(rider)
        requireThat(trip.metadata?.e2e_test === true, 'Server has not marked the trip as e2e_test; stopping')
        if (booked.authorization?.ok !== true || booked.authorization.skipped) {
          continuedWithoutHold = shouldContinueWithoutHold({
            flag: args.includes('--continue-without-hold') && booked.authorization?.ok !== true, stripeMode: summary.stripeMode,
            tripCreated: Boolean(summary.tripId), e2eFlag: trip.metadata?.e2e_test,
          })
          const attempts = trip.metadata?.outstanding_balance?.attempts
          const stripeMessages = Array.isArray(attempts)
            ? attempts.map(attempt => attempt?.stripeError?.message).filter(Boolean) : []
          const authorization = booked.authorization
          const code = authorization?.code || authorization?.failure?.code || authorization?.outstanding?.code || 'not exposed'
          throw new Error(failureDetail(`Fare authorization failed or was skipped; authorization code ${code}`,
            ...stripeMessages, authorization))
        }
        let pi = booked.authorization.authorization?.paymentIntentId || trip.metadata?.fare_authorization?.paymentIntentId
        if (!pi) {
          const payments = await rider.from('payments').select('stripe_payment_intent_id').eq('trip_id', summary.tripId).limit(10)
          if (!payments.error) pi = payments.data?.find(row => row.stripe_payment_intent_id)?.stripe_payment_intent_id
        }
        summary.paymentIntentId = pi || null
        return `trip ${summary.tripId}; ${pi ? `PaymentIntent ${pi}` : 'PaymentIntent id not exposed/readable'}; fare ${booked.fareCents} cents`
      }, () => continuedWithoutHold)
      await step('offer', async () => {
        const trip = await readTrip()
        requireThat(trip.metadata?.offer_driver_id === driverId, 'Offer is not assigned to the test driver')
        if (trip.status === 'searching') await api(driver, '/api/driver?action=mark-offered', { tripId: summary.tripId })
        return 'test driver can read their exclusive offer'
      })
      await step('accept', async () => {
        const accepted = await acceptTrip(driver, await readTrip(), driverId)
        requireThat(accepted.status === 'accepted' && accepted.driver_id === driverId, failureDetail('Conditional acceptance failed', accepted))
        return `trip ${summary.tripId}: accepted with driverDesk locked economics`
      })
      await step('en_route', () => advance('arriving'))
      await step('pickup', async () => { await presence(true); return advance('arrived') })
      await step('in_progress', () => advance('in_progress'))
      await step('complete', async () => {
        await presence(true, ride.destLat, ride.destLng)
        const detail = await advance('completed')
        await presence(false)
        return detail
      })
      await step('capture', async () => {
        const trip = await readTrip(rider)
        const payment = settle?.payment
        const auth = trip.metadata?.fare_authorization
        requireThat(settle?.ok === true && payment?.ok === true && payment.status === 'succeeded'
          && payment.paymentIntentId && payment.amountCents > 0
          && (auth?.status === 'captured' || (continuedWithoutHold && payment.method === 'card')),
        failureDetail(continuedWithoutHold
          ? 'Settlement did not prove a captured hold or successful direct card charge'
          : 'Settlement did not prove a captured card hold', settle, payment))
        summary.capturedCents = payment.amountCents
        return `${auth?.status === 'captured' ? 'captured hold' : 'direct card charge succeeded'} ${payment.amountCents} cents; PaymentIntent ${payment.paymentIntentId}; payment_status ${trip.payment_status || 'not exposed'}`
      })
      await step('tip', async () => {
        const path = '/api/driver?action=tip-choice'
        const offer = await api(rider, path, { mode: 'offer', tripId: summary.tripId })
        requireThat(offer?.ok === true, failureDetail('Could not load tip offer', offer))
        const smallest = (Array.isArray(offer.presets) ? offer.presets : [])
          .filter(row => typeof row?.id === 'string' && Number.isFinite(row.cents) && row.cents > 0)
          .sort((a, b) => a.cents - b.cents)[0]
        const customDollar = Number.isFinite(offer.custom?.minCents) && offer.custom.minCents <= 100
          && Number.isFinite(offer.custom?.maxCents) && offer.custom.maxCents >= 100
        requireThat(customDollar || smallest, 'Tip offer has no positive choice or custom $1 option')
        const body = { mode: 'record', tripId: summary.tripId,
          choiceId: customDollar ? 'custom' : smallest.id,
          ...(customDollar ? { customDollars: '1' } : {}) }
        const result = await api(rider, path, body)
        // Allowlist payment diagnostics; response bodies may contain client secrets.
        const paymentInfo = [result?.choice, result, result?.payment].flatMap(info => {
          if (!info) return []
          return ['charged', 'chargedTipCents', 'chargeStatus', 'paymentIntentId', 'status']
            .filter(key => ['string', 'number', 'boolean'].includes(typeof info[key]))
            .map(key => `${key} ${info[key]}`)
        }).join('; ')
        requireThat(result?.ok === true, failureDetail('Saved-card tip record did not succeed', result))
        const trip = await retryRead(async () => {
          const row = await readTrip(rider)
          requireThat(Number.isFinite(Number(row.tip_cents)) && Number(row.tip_cents) > 0,
            `Rider trip read did not verify positive tip_cents; choice ${body.choiceId}; ${paymentInfo || 'payment info not exposed'}`)
          return row
        })
        return `choice ${body.choiceId}; rider trip tip_cents ${trip.tip_cents}; ${paymentInfo || 'payment info not exposed'}`
      })
      await step('payout_ledger', async () => retryRead(async () => {
        const ledger = await driver.from('driver_payouts').select('trip_id, driver_id, amount_cents, status')
          .eq('trip_id', summary.tripId).eq('driver_id', driverId).maybeSingle()
        if (!ledger.error && ledger.data?.amount_cents > 0) {
          summary.capturePayoutExercised = true
          return `ledger ${ledger.data.amount_cents} cents; status ${ledger.data.status}`
        }
        const trip = await readTrip()
        const payout = trip.metadata?.payout
        requireThat(trip.driver_id === driverId && payout?.amountCents > 0 && payout.status,
          failureDetail('No positive payout ledger row or trip metadata.payout visible', ledger.error, payout))
        summary.capturePayoutExercised = true
        return `trip metadata ledger ${payout.amountCents} cents; status ${payout.status} (pending/failed without Connect is expected)`
      }))
    }
  } catch {
    for (const name of ['healthz', 'signin', 'stripe_mode', ...rideSteps]) {
      if (!summary.steps.some(row => row.name === name)) record(name, 'SKIP', 'stopped after failure')
    }
  } finally {
    if (!onlineTouched && !bookingAttempted) record('cleanup', 'SKIP', 'no driver presence or trip created')
    else {
      try {
        await step('cleanup', async () => {
          // Offline first, even if cancellation later fails.
          let offlineError
          try { await presence(false) } catch (error) { offlineError = error }
          if (bookingAttempted && !summary.tripId) {
            const recovered = await rider.from('trips').select('id').eq('rider_id', riderId)
              .eq('rider_note', NOTE).gte('created_at', startedAt).order('created_at', { ascending: false }).limit(2)
            requireThat(!recovered.error && recovered.data?.length <= 1, failureDetail('Cannot safely identify booking after lost response; inspect test rider trips', recovered.error))
            summary.tripId = recovered.data?.[0]?.id || null
          }
          if (summary.tripId) {
            let trip = await readTrip(rider)
            if (!['completed', 'canceled', 'cancelled_wait'].includes(trip.status)) {
              const canceled = await api(rider, '/api/stripe-payment-methods?action=settle', { tripId: summary.tripId, action: 'cancel' })
              requireThat(canceled.ok === true, failureDetail('Rider cancellation did not succeed', canceled))
              trip = await readTrip(rider)
            }
            requireThat(['completed', 'canceled', 'cancelled_wait'].includes(trip.status)
              && trip.metadata?.fare_authorization?.status !== 'requires_capture', 'Trip still active or hold still open')
          }
          if (offlineError) throw offlineError
          return `driver offline; trip ${summary.tripId || 'none'} retained for audit`
        })
      } catch { /* step already recorded the cleanup failure */ }
    }
    globalThis.fetch = originalFetch
    if (oldApiBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE
    else process.env.EXPO_PUBLIC_API_BASE = oldApiBase
    console.log(JSON.stringify(summary))
  }
  return summary.steps.some(row => row.status === 'FAIL') ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
