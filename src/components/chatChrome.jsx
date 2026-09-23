import { navigate } from '../lib/navigation'

const bubble = (mine) => ({
  alignSelf: mine ? 'flex-end' : 'flex-start',
  maxWidth: '92%',
  padding: '10px 12px',
  borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
  background: mine ? 'linear-gradient(135deg, #F56600, #ff7a1a)' : 'rgba(82,45,128,0.08)',
  color: mine ? '#fff' : 'var(--ink)',
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
})

export function ChatShell({ kicker, title, subtitle, children }) {
  return (
    <div style={{
      borderRadius: 18,
      overflow: 'hidden',
      border: '1px solid rgba(82,45,128,0.16)',
      background: 'rgba(255,255,255,0.72)',
      marginBottom: 12,
    }}>
      <div style={{
        padding: '12px 14px',
        background: 'linear-gradient(135deg, #F56600 0%, #522D80 100%)',
        color: '#fff',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, opacity: 0.9 }}>{kicker}</div>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.92, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}

export function Segment({ value, options, onChange, label }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
      {options.map((option) => {
        const on = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            className="pressable"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              color: on ? '#fff' : '#522D80',
              background: on ? 'linear-gradient(135deg, #F56600, #522D80)' : 'rgba(255,255,255,0.8)',
              border: on ? 'none' : '1px solid rgba(82,45,128,0.18)',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function SpeechBanner({ text }) {
  if (!text) return null
  return (
    <div style={{
      fontSize: 12,
      lineHeight: 1.4,
      padding: '8px 10px',
      borderRadius: 12,
      marginBottom: 8,
      color: '#522D80',
      background: 'rgba(245,102,0,0.12)',
      border: '1px solid rgba(245,102,0,0.28)',
    }}>
      {text}
    </div>
  )
}

export function ChipRow({ chips, disabled, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          className="pressable"
          disabled={disabled}
          onClick={() => onPick(chip.text)}
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            color: '#522D80',
            background: 'rgba(245,102,0,0.1)',
            border: '1px solid rgba(245,102,0,0.28)',
          }}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

export function MessageList({ messages, onAction }) {
  return (
    <div
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: 320,
        overflowY: 'auto',
        marginBottom: 8,
        paddingRight: 2,
      }}
    >
      {messages.map((message) => (
        <div key={message.id} style={bubble(message.role === 'user')}>
          <div>{message.content}</div>
          {message.role === 'assistant' && message.actions?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {message.actions.map((item) => (
                <button
                  key={`${item.route}-${item.label}`}
                  type="button"
                  className="pressable"
                  onClick={() => onAction(item)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    color: '#522D80',
                    background: '#fff',
                    border: '1px solid rgba(82,45,128,0.2)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function Composer({ value, onChange, onSubmit, busy, placeholder, mode, listening, onMic }) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 2000))}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        style={{
          flex: 1,
          padding: '12px 12px',
          borderRadius: 14,
          border: '1px solid rgba(82,45,128,0.18)',
          background: '#fff',
          color: 'var(--ink)',
        }}
      />
      {mode === 'voice' && (
        <button
          type="button"
          className="pressable"
          onClick={onMic}
          disabled={busy}
          aria-pressed={listening}
          style={{
            padding: '0 12px',
            borderRadius: 14,
            fontWeight: 800,
            color: listening ? '#fff' : '#522D80',
            background: listening ? '#F56600' : 'rgba(82,45,128,0.08)',
            border: '1px solid rgba(82,45,128,0.16)',
          }}
        >
          {listening ? '…' : 'Mic'}
        </button>
      )}
      <button
        type="submit"
        className="pressable"
        disabled={busy || !value.trim()}
        style={{
          padding: '0 14px',
          borderRadius: 14,
          fontWeight: 800,
          color: '#fff',
          background: busy || !value.trim() ? 'rgba(82,45,128,0.35)' : '#522D80',
        }}
      >
        {busy ? '…' : 'Send'}
      </button>
    </form>
  )
}

export function openAction(item) {
  if (!item?.route) return
  navigate(item.route, item.params || {})
}
