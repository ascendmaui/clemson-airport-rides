import './StartStopRides.css'

/**
 * Primary Start rides / Stop rides control, with the smaller off-the-clock switch.
 * Both call the same setter. available true means on the clock.
 */
export function StartStopRides({
  available,
  dnd,
  canStart = true,
  minimized = false,
  onChange,
  onExpand,
  onMinimize,
}) {
  const startBlocked = !available && !canStart
  if (available && minimized) {
    return (
      <div className="shift-bar shift-bar--compact" data-shift-bar="1">
        <button type="button" className="shift-compact pressable" onClick={onExpand}>
          You're online
        </button>
        <button type="button" className="shift-end pressable" onClick={() => onChange?.(false)}>
          End
        </button>
      </div>
    )
  }
  return (
    <div className="shift-bar" data-shift-bar="1">
      <button
        type="button"
        className="shift-button pressable"
        disabled={startBlocked}
        aria-pressed={available}
        onClick={() => onChange?.(!available)}
      >
        {available ? 'Stop rides' : 'Start rides'}
      </button>
      <button
        type="button"
        className="shift-switch pressable"
        role="switch"
        aria-checked={dnd}
        aria-label="Off the clock"
        onClick={() => onChange?.(Boolean(dnd))}
      >
        <span className="shift-switch__copy">
          <span className="shift-switch__label">Off the clock</span>
          <span className="shift-switch__hint">Do not disturb until you turn this off</span>
        </span>
        <span className="shift-switch__track" data-on={dnd ? '1' : '0'} aria-hidden="true">
          <span className="shift-switch__knob" />
        </span>
      </button>
      {available && onMinimize ? (
        <button type="button" className="shift-minimize pressable" onClick={onMinimize}>
          Minimize
        </button>
      ) : null}
    </div>
  )
}
