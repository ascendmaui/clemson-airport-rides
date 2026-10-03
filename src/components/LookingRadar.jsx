import './LookingRadar.css'

/** Subtle radar on the driver map while they are on the clock looking for offers. */
export function LookingRadar() {
  return (
    <div className="looking-radar" aria-hidden="true">
      <span className="looking-radar__ring" />
      <span className="looking-radar__ring" />
      <span className="looking-radar__ring" />
      <span className="looking-radar__sweep" />
      <span className="looking-radar__core" />
      <span className="looking-radar__label">Looking for rides</span>
    </div>
  )
}
