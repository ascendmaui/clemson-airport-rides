import { DriverShiftControl } from './DriverShiftControl'
import { MapTypeSelect } from './MapTypeSelect'

export function DriverDeskHeader({
  earningsLabel,
  onMenu,
  onEarnings,
  showMapType = false,
  mapTypeId = 'roadmap',
  onMapTypeChange,
  showShift = false,
  onShift = false,
  shiftBusy = false,
  onStartShift,
  onStopShift,
  showLocate = false,
  onLocate,
}) {
  return (
    <div className="driver-desk-header">
      <button
        type="button"
        className="pressable driver-desk-header__menu"
        onClick={onMenu}
      >
        ☰
      </button>
      {showMapType ? (
        <MapTypeSelect value={mapTypeId} onChange={onMapTypeChange} />
      ) : null}
      <div className="driver-desk-header__earnings" title="Completed trip earnings">
        <button type="button" className="pressable" onClick={onEarnings}>
          {earningsLabel}
        </button>
      </div>
      {showLocate ? (
        <button
          type="button"
          className="pressable driver-desk-header__locate"
          aria-label="Use current location"
          onClick={onLocate}
        >
          ◎
        </button>
      ) : null}
      {showShift ? (
        <DriverShiftControl
          compact
          onShift={onShift}
          busy={shiftBusy}
          onStart={onStartShift}
          onStop={onStopShift}
        />
      ) : null}
    </div>
  )
}
