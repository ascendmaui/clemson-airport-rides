import React from 'react'
import { normalizeErrorCopy } from '../lib/errorUtils.js'

export { normalizeErrorCopy }

/**
 * AccessibleAlert component:
 * Accessible, WCAG 2.2-compliant alert container announcing to assistive technologies.
 * Renders role="alert" (or "status") with aria-live="assertive" (or "polite").
 */
export function AccessibleAlert({
  error,
  message,
  title,
  variant = 'danger', // 'danger' | 'warning' | 'info'
  role,
  ariaLive,
  onDismiss,
  onRetry,
  retryLabel = 'Try again',
  dismissLabel = 'Dismiss',
  className = '',
  style = {},
  children,
}) {
  const displayMessage = message || (error ? normalizeErrorCopy(error) : '')
  if (!displayMessage && !children && !title) return null

  const computedRole = role || (variant === 'danger' ? 'alert' : 'status')
  const computedLive = ariaLive || (variant === 'danger' ? 'assertive' : 'polite')

  const variantClass = `accessible-alert--${variant}`

  return (
    <div
      role={computedRole}
      aria-live={computedLive}
      className={`accessible-alert ${variantClass} ${className}`.trim()}
      style={style}
    >
      <div className="accessible-alert__icon" aria-hidden="true">
        {variant === 'danger' ? (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        ) : variant === 'warning' ? (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        )}
      </div>

      <div className="accessible-alert__body">
        {title && <div className="accessible-alert__title">{title}</div>}
        {displayMessage && <div className="accessible-alert__message">{displayMessage}</div>}
        {children}

        {(onRetry || onDismiss) && (
          <div className="accessible-alert__actions">
            {onRetry && (
              <button
                type="button"
                className="accessible-alert__btn accessible-alert__btn--retry pressable"
                onClick={onRetry}
                aria-label={retryLabel}
              >
                {retryLabel}
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                className="accessible-alert__btn accessible-alert__btn--dismiss pressable"
                onClick={onDismiss}
                aria-label={dismissLabel}
              >
                {dismissLabel}
              </button>
            )}
          </div>
        )}
      </div>

      {onDismiss && !onRetry && (
        <button
          type="button"
          className="accessible-alert__close pressable"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          ×
        </button>
      )}
    </div>
  )
}

/**
 * AccessibleErrorBoundary:
 * Traps runtime rendering errors within children, preventing whole-page blanking,
 * and renders an accessible fallback alert with retry capability.
 */
export class AccessibleErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (typeof this.props.onReset === 'function') {
      this.props.onReset()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset: this.handleReset })
          : this.props.fallback
      }

      return (
        <div
          role="alert"
          aria-live="assertive"
          className="accessible-error-boundary"
          style={this.props.style}
        >
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2, color: 'var(--danger)', marginBottom: 6 }}>
            {this.props.badge || 'SOMETHING WENT WRONG'}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--purple)', margin: '4px 0 8px' }}>
            {this.props.title || 'Unable to display this view'}
          </h2>
          <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, marginTop: 0, marginBottom: 16 }}>
            {normalizeErrorCopy(this.state.error, 'An unexpected error occurred while loading this section. Please try again.')}
          </p>
          <button
            type="button"
            className="pressable primary-cta"
            onClick={this.handleReset}
            aria-label="Try loading this section again"
            style={{
              padding: '10px 20px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {this.props.resetLabel || 'Try again'}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
