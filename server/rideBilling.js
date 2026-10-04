/**
 * How a website ride will be paid.
 * The server prices the ride. Client fare, deposit, amount, total, and
 * isStudent are not inputs. Selecting credits records the choice only:
 * the balance is not debited and no card is charged.
 */

const CHOICES = ['credits', 'no_card', 'deposit']

function missingRelation(error) {
  return /relation|does not exist|schema cache|could not find/i.test(error?.message || '')
}

function finiteCents(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

/**
 * Server balance for this rider.
 * A missing account row is zero. A missing ledger table is zero.
 * A failed read is unknown — never a made-up positive balance.
 */
export async function readRideCreditBalance(sb, userId) {
  if (!sb || !userId) return { balanceCents: 0, known: false }
  const acct = await sb.from('credit_accounts').select('balance_cents').eq('user_id', userId).maybeSingle()
  if (!acct.error) {
    if (!acct.data || acct.data.balance_cents == null) return { balanceCents: 0, known: true }
    const cents = finiteCents(acct.data.balance_cents)
    return { balanceCents: cents == null ? 0 : cents, known: true }
  }
  if (!missingRelation(acct.error)) return { balanceCents: 0, known: false }

  const prof = await sb.from('profiles').select('credit_balance_cents').eq('id', userId).maybeSingle()
  if (prof.error) {
    if (missingRelation(prof.error)) return { balanceCents: 0, known: true }
    return { balanceCents: 0, known: false }
  }
  if (!prof.data || prof.data.credit_balance_cents == null) return { balanceCents: 0, known: true }
  const cents = finiteCents(prof.data.credit_balance_cents)
  return { balanceCents: cents == null ? 0 : cents, known: true }
}

export function creditsCoverFare(balanceCents, fareCents) {
  const fare = finiteCents(fareCents)
  const balance = finiteCents(balanceCents)
  if (fare == null || balance == null) return false
  return fare > 0 && balance >= fare
}

/**
 * Payment choices for a server-priced ride.
 * Campus rides stay completable with no card.
 * Airport rides keep the priced deposit (25% from the fare card).
 */
export function billingOffer({
  fareCents,
  depositCents,
  balanceCents = 0,
  balanceKnown = false,
  airport = null,
} = {}) {
  const fare = finiteCents(fareCents)
  const deposit = finiteCents(depositCents) ?? 0
  const balance = balanceKnown ? (finiteCents(balanceCents) ?? 0) : null
  const campus = !airport && deposit <= 0
  const creditsSelectable = balance != null && creditsCoverFare(balance, fare)
  const options = campus
    ? [
      { id: 'no_card', enabled: true },
      { id: 'credits', enabled: creditsSelectable },
    ]
    : [
      { id: 'deposit', enabled: deposit > 0 },
      { id: 'credits', enabled: creditsSelectable },
    ]
  return {
    fareCents: fare,
    depositCents: deposit,
    remainingCents: fare == null ? null : Math.max(0, fare - deposit),
    balanceCents: balance,
    balanceKnown: Boolean(balanceKnown),
    airport: airport || null,
    campus,
    creditsSelectable,
    options,
  }
}

export function normalizeBillingChoice(value) {
  if (value == null || value === '') return null
  const choice = String(value)
  return CHOICES.includes(choice) ? choice : 'invalid'
}

/**
 * Accept a rider's payment choice against the server price and balance.
 * Does not change the balance.
 */
export function resolveBillingChoice({
  choice,
  fareCents,
  depositCents,
  balanceCents = 0,
  balanceKnown = false,
  airport = null,
} = {}) {
  const offer = billingOffer({ fareCents, depositCents, balanceCents, balanceKnown, airport })
  const requested = normalizeBillingChoice(choice)
  if (requested == null) {
    return {
      ok: true,
      recorded: false,
      choice: offer.campus ? 'no_card' : 'deposit',
      offer,
    }
  }
  if (requested === 'invalid') {
    return { ok: false, status: 400, error: 'Choose no card, the 25% deposit, or ride credits.', code: 'billing_choice_invalid' }
  }

  switch (requested) {
    case 'credits':
      if (!offer.balanceKnown) {
        return { ok: false, status: 409, error: 'Ride credits are unavailable right now.', code: 'credits_unavailable', offer }
      }
      if (!offer.creditsSelectable) {
        return {
          ok: false,
          status: 409,
          error: 'Ride credits do not cover this ride.',
          code: 'credits_insufficient',
          offer,
        }
      }
      return { ok: true, recorded: true, choice: 'credits', offer }
    case 'no_card':
      if (!offer.campus) {
        return {
          ok: false,
          status: 409,
          error: 'Airport rides request a 25% deposit.',
          code: 'airport_deposit_required',
          offer,
        }
      }
      return { ok: true, recorded: true, choice: 'no_card', offer }
    case 'deposit':
      if (offer.campus || offer.depositCents <= 0) {
        return {
          ok: false,
          status: 409,
          error: 'Campus rides are requested with no card.',
          code: 'campus_no_card',
          offer,
        }
      }
      return { ok: true, recorded: true, choice: 'deposit', offer }
    default: {
      const unknown = requested
      throw new Error(`Unhandled billing choice: ${String(unknown)}`)
    }
  }
}

/** Stored on the trip. debit and charge stay zero. */
export function billingSnapshot(resolved) {
  if (!resolved?.recorded) return {}
  const offer = resolved.offer || {}
  return {
    billing_choice: resolved.choice,
    billing_fare_cents: offer.fareCents,
    billing_deposit_cents: offer.depositCents,
    billing_balance_cents: offer.balanceKnown ? offer.balanceCents : null,
    billing_debited_cents: 0,
    billing_charged: false,
  }
}

export async function billingForPricedRide(sb, userId, body, priced) {
  const requested = body?.billingChoice ?? body?.billing_choice
  if (requested == null || requested === '') return { snapshot: {}, error: null }
  const needsBalance = String(requested) === 'credits'
  const balance = needsBalance
    ? await readRideCreditBalance(sb, userId)
    : { balanceCents: 0, known: false }
  const resolved = resolveBillingChoice({
    choice: requested,
    fareCents: priced?.fareCents,
    depositCents: priced?.depositCents,
    balanceCents: balance.balanceCents,
    balanceKnown: needsBalance ? balance.known : false,
    airport: priced?.airport || null,
  })
  if (!resolved.ok) return { snapshot: null, error: resolved }
  return { snapshot: billingSnapshot(resolved), error: null, resolved }
}
