export function DriverShiftControl({
  onShift,
  busy = false,
  onStart,
  onStop,
  compact = false,
}) {
  const label = onShift ? 'Stop shift' : 'Start shift'
  const action = onShift ? onStop : onStart
  return (
    <div className={compact ? 'driver-shift driver-shift--compact' : 'driver-shift'}>
      {!compact && (
        <>
          <div className="driver-shift__status" role="status">
            <span className={onShift ? 'driver-shift__dot driver-shift__dot--on' : 'driver-shift__dot'} />
            <span>{onShift ? "You're on shift" : "You're off the clock"}</span>
          </div>
          <p className="driver-shift__copy">
            {onShift
              ? 'Looking for rides in Clemson. Stop the shift when you want new offers to stop. A trip you already accepted keeps going.'
              : 'Start a shift to receive ride offers. You will not get offers while you are off the clock.'}
          </p>
        </>
      )}
      <button
        type="button"
        className={`pressable driver-shift__button ${onShift ? 'driver-shift__button--stop' : 'driver-shift__button--start'}`}
        onClick={action}
        disabled={busy}
        aria-pressed={onShift}
        aria-label={onShift ? 'Stop shift. This does not cancel an active trip.' : 'Start shift'}
        title={onShift ? 'Stop new offers. This does not cancel an active trip.' : 'Start a shift to receive ride offers'}
      >
        {busy ? 'Saving…' : label}
      </button>
    </div>
  )
}
