import { A11yBadge } from './A11yBadge.jsx'
import { SiteIcon, rideTypeSiteIcon } from './SiteIcon.jsx'

/**
 * One ride type card. Clean card, upfront price on the right, obvious selected
 * state (Clemson orange ring + check), purple accents for ETA and badges.
 */
export function TierRow({ tier, selected, onSelect }) {
  const priced = Number.isFinite(tier.price)
  return (
    <button
      type="button"
      className={`pressable tier-card ${selected ? 'selected' : ''}`}
      aria-pressed={Boolean(selected)}
      onClick={() => onSelect(tier)}
    >
      <span className="tier-card__icon" aria-hidden="true">
        <SiteIcon name={rideTypeSiteIcon(tier.id)} size={26} />
      </span>
      <span className="tier-card__body">
        <span className="tier-card__title">
          <span className="tier-card__name">{tier.name}</span>
          {tier.badge && (
            <A11yBadge variant="purple">
              {tier.badge}
            </A11yBadge>
          )}
        </span>
        <span className="tier-card__meta">
          <span className="tier-card__eta">{tier.eta}</span>
          {tier.meta ? <span> · {tier.meta}</span> : null}
        </span>
      </span>
      <span className="tier-card__price" data-testid={`tier-price-${tier.id}`}>
        {priced ? `$${tier.price.toFixed(2)}` : '—'}
      </span>
      <span className="tier-card__check" aria-hidden="true">
        {selected ? <SiteIcon name="check" size={14} /> : null}
      </span>
    </button>
  )
}
