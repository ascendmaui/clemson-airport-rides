import { quietFromPrefs } from '../lib/notificationPrefs'

export function QuietHoursCard({ prefs, saving = false, onChange }) {
  const quiet = quietFromPrefs(prefs)
  const paused = quiet.dnd || quiet.scheduleEnabled

  function patch(next) {
    onChange?.({ ...quiet, ...next })
  }

  return (
    <div data-quiet-hours="1" style={{ padding: '12px 0 4px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 4 }}>Quiet hours</div>
      <p style={{ fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 10, lineHeight: 1.4 }}>
        Off the clock or inside the window, new ride requests stay silent — no chime and no vibration.
      </p>

      <ToggleRow
        label="Off the clock"
        hint="Do not disturb until you turn this off"
        on={quiet.dnd}
        disabled={saving}
        onClick={() => patch({ dnd: !quiet.dnd })}
      />
      <ToggleRow
        label="Scheduled quiet hours"
        hint="Mute ride alerts overnight or between classes"
        on={quiet.scheduleEnabled}
        disabled={saving}
        onClick={() => patch({ scheduleEnabled: !quiet.scheduleEnabled })}
      />

      {quiet.scheduleEnabled && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <label style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            From
            <input
              type="time"
              value={quiet.start}
              disabled={saving}
              onChange={(e) => patch({ start: e.target.value })}
              style={timeStyle}
            />
          </label>
          <label style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            Until
            <input
              type="time"
              value={quiet.end}
              disabled={saving}
              onChange={(e) => patch({ end: e.target.value })}
              style={timeStyle}
            />
          </label>
        </div>
      )}

      {paused && (
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--orange)' }}>
          {quiet.dnd ? 'Off the clock — ride alerts paused' : `Quiet ${quiet.start}–${quiet.end}`}
        </div>
      )}
    </div>
  )
}

function ToggleRow({ label, hint, on, onClick, disabled }) {
  return (
    <button
      type="button"
      className="pressable"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        padding: '8px 0',
      }}
    >
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>{hint}</div>
      </span>
      <span
        aria-hidden
        style={{
          width: 48,
          height: 28,
          borderRadius: 999,
          background: on ? 'var(--purple)' : 'var(--border)',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 22 : 3,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: 'var(--shadow-pill)',
            transition: 'left 220ms var(--ease-spring)',
          }}
        />
      </span>
    </button>
  )
}

const timeStyle = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  fontWeight: 600,
  color: 'var(--ink)',
  background: 'rgba(255,255,255,0.8)',
}
