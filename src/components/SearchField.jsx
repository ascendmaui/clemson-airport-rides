import { searchFieldInputStyle } from '../lib/touchA11y'

export function SearchField({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder = 'Where are you going?',
  orangeOutline,
  label = 'Search destination or airport',
  id = 'destination-search-field',
  autoComplete = 'off',
  disabled = false,
  className = '',
  ...rest
}) {
  return (
    <div
      role="search"
      className={`search-field-container ${className}`}
      onPointerDown={(event) => {
        const input = event.currentTarget.querySelector('input')
        if (!input || event.target === input) return
        event.preventDefault()
        input.focus()
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '4px 16px',
        minHeight: 52,
        background: 'var(--surface)',
        borderRadius: 16,
        border: orangeOutline ? '2px solid var(--orange)' : '1px solid var(--border)',
        boxShadow: orangeOutline ? '0 4px 16px rgba(245,102,0,0.12)' : 'var(--shadow-pill)',
        transition: 'border-color 180ms var(--ease-soft), box-shadow 180ms var(--ease-soft)',
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <svg
        aria-hidden="true"
        focusable="false"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--ink-tertiary)"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-label={label || placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className="search-field-input"
        style={searchFieldInputStyle({ color: 'var(--ink)' })}
        {...rest}
      />
    </div>
  )
}
