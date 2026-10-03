/** Clemson-orange logo shown while pick-a-driver is still searching. */
export function SearchingLogo({ label = 'Finding a driver' }) {
  return (
    <div className="clemson-search-logo" role="status" aria-live="polite" aria-label={label}>
      <div className="clemson-search-logo__mark" aria-hidden="true">
        <span className="clemson-search-logo__paw">🐾</span>
      </div>
      <p className="clemson-search-logo__label">{label}</p>
    </div>
  )
}
