import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalA11y } from './A11yModal'

/**
 * Styled replacement for window.confirm(): a glassy, centered alert dialog
 * with a spring-in card, Escape/backdrop to cancel, and focus trapping.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, onConfirm, onCancel }) {
  const confirmRef = useRef(null)
  const containerRef = useModalA11y({ isOpen: open, onClose: onCancel, initialFocusRef: confirmRef })
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'rgba(15, 10, 25, 0.38)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        animation: 'cr-confirm-fade 160ms ease-out',
      }}
    >
      <style>{'@keyframes cr-confirm-fade{from{opacity:0}to{opacity:1}}@keyframes cr-confirm-pop{0%{opacity:0;transform:scale(.92) translateY(8px)}70%{transform:scale(1.015)}100%{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){[data-confirm-card]{animation:none!important}}'}</style>
      <div
        ref={containerRef}
        data-confirm-card
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360, borderRadius: 24, padding: '22px 20px 16px', textAlign: 'center',
          background: 'rgba(255,255,255,0.78)', backdropFilter: 'saturate(180%) blur(24px)', WebkitBackdropFilter: 'saturate(180%) blur(24px)',
          border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', color: '#111114',
          animation: 'cr-confirm-pop 260ms cubic-bezier(.2,.9,.3,1.2)',
        }}
      >
        <h2 id="confirm-dialog-title" style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
        {message ? <p id="confirm-dialog-message" style={{ margin: '8px 0 18px', fontSize: 14, lineHeight: 1.45, color: 'rgba(60,60,67,0.85)' }}>{message}</p> : null}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="pressable" onClick={onCancel} style={{ flex: 1, minHeight: 44, borderRadius: 14, border: 'none', background: 'rgba(120,120,128,0.16)', color: '#111114', fontWeight: 600, fontSize: 15 }}>{cancelLabel}</button>
          <button ref={confirmRef} type="button" className="pressable" onClick={onConfirm} style={{ flex: 1, minHeight: 44, borderRadius: 14, border: 'none', background: destructive ? '#D93025' : '#F56600', color: '#FFFFFF', fontWeight: 700, fontSize: 15 }}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** const { confirm, confirmDialog } = useConfirm(); if (!(await confirm({ title, message }))) return */
export function useConfirm() {
  const [state, setState] = useState(null)
  const confirm = useCallback((options) => new Promise((resolve) => {
    setState({ ...options, resolve })
  }), [])
  const settle = (value) => {
    state?.resolve(value)
    setState(null)
  }
  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(state)}
      title={state?.title}
      message={state?.message}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      destructive={state?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )
  return { confirm, confirmDialog }
}
