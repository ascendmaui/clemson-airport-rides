import {
  displayedPassengers,
  partyCapacityMessage,
  partyFareCopy,
  passengerCountLabel,
  stepPassengers,
  SCHEDULE_PARTY_SEAT_CAP,
  weekendWindowCopy,
  weekendWindowNote,
} from '../lib/schedulePartyCopy'
import { weekendHelperIso } from '../lib/scheduledRideModel'

const stepButtonStyle = {
  minWidth: 44,
  minHeight: 44,
  width: 44,
  height: 44,
  borderRadius: 12,
  fontWeight: 800,
  fontSize: 22,
  lineHeight: 1,
  color: '#522D80',
  background: 'rgba(82,45,128,0.08)',
  border: '1px solid rgba(82,45,128,0.25)',
}

export function PassengerStepper({ passengers, onChange }) {
  const count = displayedPassengers(passengers)
  const label = passengerCountLabel(count)
  const atMin = count <= 1
  const atMax = count >= SCHEDULE_PARTY_SEAT_CAP

  return (
    <div
      data-testid="passenger-stepper"
      role="group"
      aria-labelledby="scheduled-passengers-label"
      aria-describedby="party-capacity-message party-fare-note"
      style={{ marginBottom: 14 }}
    >
      <div id="scheduled-passengers-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
        Passengers
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          className="pressable touch-target-min"
          aria-label="Fewer passengers"
          disabled={atMin}
          onClick={() => onChange?.(stepPassengers(count, 'down'))}
          style={{ ...stepButtonStyle, opacity: atMin ? 0.4 : 1 }}
        >
          −
        </button>
        <output
          data-testid="passenger-count"
          aria-live="polite"
          style={{ minWidth: 140, textAlign: 'center', fontWeight: 800, fontSize: 16, color: '#522D80' }}
        >
          {label}
        </output>
        <button
          type="button"
          className="pressable touch-target-min"
          aria-label="More passengers"
          disabled={atMax}
          onClick={() => onChange?.(stepPassengers(count, 'up'))}
          style={{ ...stepButtonStyle, opacity: atMax ? 0.4 : 1 }}
        >
          +
        </button>
      </div>
      <p
        id="party-capacity-message"
        data-testid="party-capacity-message"
        style={{ fontSize: 13, color: '#522D80', fontWeight: 700, marginTop: 8, marginBottom: 0, lineHeight: 1.45 }}
      >
        {partyCapacityMessage(count)}
      </p>
      <p
        id="party-fare-note"
        data-testid="party-fare-note"
        style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4, marginBottom: 0, lineHeight: 1.45 }}
      >
        {partyFareCopy()}
      </p>
    </div>
  )
}

export function WeekendWindowHelper({ date, time, showOverview = false, showNote = true }) {
  const note = weekendWindowNote(weekendHelperIso(date, time))
  return (
    <div data-testid="weekend-window-helper">
      {showOverview ? (
        <p
          id="weekend-window-copy"
          data-testid="weekend-window-copy"
          style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 0, lineHeight: 1.45 }}
        >
          {weekendWindowCopy()}
        </p>
      ) : null}
      {showNote ? (
        <p
          id="weekend-window-note"
          data-testid="weekend-window-note"
          style={{ fontSize: 13, color: '#522D80', fontWeight: 700, marginTop: 0, marginBottom: 14, lineHeight: 1.45 }}
        >
          {note}
        </p>
      ) : null}
    </div>
  )
}
