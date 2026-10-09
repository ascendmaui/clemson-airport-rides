import { formatUsdFromCents } from '../lib/pricing'
import { depositSurfaceCopy } from '../../packages/rides-native/riderMoney.js'

function optionClass(selected, enabled) {
  const names = ['billing-option', 'pressable']
  if (selected) names.push('billing-option--selected')
  if (!enabled) names.push('billing-option--disabled')
  return names.join(' ')
}

export function BillingPicker({ offer, selected, onSelect, loading = false, signedIn = false }) {
  if (loading) {
    return (
      <div className="billing-picker" data-testid="billing-picker">
        <div className="billing-kicker">How this ride is paid</div>
        <p className="billing-copy">Checking the server price and ride credits…</p>
      </div>
    )
  }

  if (!offer) {
    return (
      <div className="billing-picker" data-testid="billing-picker">
        <div className="billing-kicker">How this ride is paid</div>
        <p className="billing-copy">
          {signedIn
            ? 'The server price is unavailable right now. Ride credits stay hidden until it loads.'
            : 'Sign in to see ride credits. Scheduling does not charge a card. The final fare is charged when the trip ends.'}
        </p>
      </div>
    )
  }

  const depositCopy = offer.depositCents > 0
    ? depositSurfaceCopy(
      { fareCents: offer.fareCents, depositCents: offer.depositCents, remainingCents: offer.remainingCents },
      'confirm',
      { studentDiscountCents: offer.discountCents },
    )
    : null
  const balanceLabel = offer.balanceKnown && offer.balanceCents != null
    ? formatUsdFromCents(offer.balanceCents)
    : null

  return (
    <div className="billing-picker" data-testid="billing-picker">
      <div className="billing-kicker">How this ride is paid</div>
      <div className="billing-options" role="radiogroup" aria-label="How this ride is paid">
        <button
          type="button"
          role="radio"
          aria-checked={selected === 'no_card' || selected === 'deposit'}
          className={optionClass(selected === 'no_card' || selected === 'deposit', true)}
          data-testid="billing-option-no_card"
          onClick={() => onSelect('no_card')}
        >
          <span className="billing-option-title">No card</span>
          <span className="billing-option-detail">A card is not charged here. The final fare is charged when the trip ends.</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={selected === 'credits'}
          aria-disabled={offer.creditsSelectable ? undefined : true}
          disabled={!offer.creditsSelectable}
          className={optionClass(selected === 'credits', offer.creditsSelectable)}
          data-testid="billing-option-credits"
          onClick={() => {
            if (offer.creditsSelectable) onSelect('credits')
          }}
        >
          <span className="billing-option-title">Ride credits</span>
          <span className="billing-option-detail" data-testid="billing-balance">
            {balanceLabel == null
              ? 'Ride credits are unavailable right now.'
              : offer.creditsSelectable
                ? `${balanceLabel} covers this ride. The balance is not spent.`
                : `${balanceLabel} does not cover this ride.`}
          </span>
        </button>
      </div>
      {depositCopy && (
        <p className="billing-deposit" data-testid="billing-deposit-request">{depositCopy}</p>
      )}
      <p className="billing-note">No card is charged when you schedule. Requesting a ride places a hold for the estimate plus a buffer.</p>
    </div>
  )
}
