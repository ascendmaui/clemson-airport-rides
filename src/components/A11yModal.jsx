import React, { useEffect, useRef } from 'react'

/**
 * Hook to manage accessibility for modal dialogs and bottom sheets:
 * 1. Escape key listener (calls onClose).
 * 2. Focus trapping inside the dialog (keeps Tab navigation within modal elements).
 * 3. Restores focus to the previously active element upon unmounting/closing.
 * 4. Disables background scrolling while modal is open.
 */
export function useModalA11y({
  isOpen = true,
  onClose,
  initialFocusRef,
  containerRef: externalContainerRef,
  disableScrollLock = false,
} = {}) {
  const internalContainerRef = useRef(null)
  const containerRef = externalContainerRef || internalContainerRef
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    // Save active element to restore later
    if (typeof document !== 'undefined' && document.activeElement) {
      previousFocusRef.current = document.activeElement
    }

    // Lock body scroll
    let originalOverflow = ''
    if (!disableScrollLock && typeof document !== 'undefined' && document.body) {
      originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    // Auto-focus initial element or dialog container
    const timer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
      } else if (containerRef.current) {
        const focusable = containerRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length > 0) {
          focusable[0].focus()
        } else {
          containerRef.current.focus()
        }
      }
    }, 40)

    // Keydown handler: Escape to close, Tab to trap focus
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose?.()
        return
      }

      if (e.key === 'Tab' && containerRef.current) {
        const focusable = containerRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first || !containerRef.current.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !containerRef.current.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown, true)
    }

    return () => {
      clearTimeout(timer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown, true)
      }
      if (!disableScrollLock && typeof document !== 'undefined' && document.body) {
        document.body.style.overflow = originalOverflow
      }
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        try {
          previousFocusRef.current.focus()
        } catch {
          // ignore focus failures on unmounted elements
        }
      }
    }
  }, [isOpen, onClose, disableScrollLock])

  return containerRef
}

/**
 * A11yModalDialog component:
 * Accessible wrapper for modal overlays and sheets.
 * Renders role="dialog", aria-modal="true", and attaches escape & focus trap handlers.
 */
export function A11yModalDialog({
  open = true,
  onClose,
  titleId,
  ariaLabel,
  children,
  className = '',
  style = {},
  overlayStyle = {},
  disableScrollLock = false,
}) {
  const dialogRef = useModalA11y({ isOpen: open, onClose, disableScrollLock })

  if (!open) return null

  return (
    <div
      className={`glass-overlay fade-in ${className}`.trim()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(11,18,32,0.48)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        ...overlayStyle,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={!titleId ? ariaLabel : undefined}
        tabIndex={-1}
        className="modal-card"
        style={{ outline: 'none', ...style }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
