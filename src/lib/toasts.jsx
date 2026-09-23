import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { IconBell, IconCar, IconCard, IconCarpool, IconClose, IconShare, IconStar } from '../components/icons'
import { categoryForToastKind, loadLocalPrefs } from './notificationPrefs'
import { playAlertTone, shouldPlayAlertTone } from './alertTone'
import { useAuth } from './auth'

const ToastContext = createContext(null)
const AUTO_MS = 5000
const MAX_VISIBLE = 4

const KIND_META = {
  ride_requested: { title: 'Ride requested', Icon: IconCar, tone: 'orange' },
  driver_accepted: { title: 'Driver accepted', Icon: IconCar, tone: 'purple' },
  driver_en_route: { title: 'Driver en route', Icon: IconCar, tone: 'orange' },
  arrived_pickup: { title: 'Arrived at pickup', Icon: IconCar, tone: 'purple' },
  trip_started: { title: 'Trip started', Icon: IconCar, tone: 'orange' },
  trip_completed: { title: 'Trip completed', Icon: IconStar, tone: 'purple' },
  canceled_midride: { title: 'Ride canceled mid-trip', Icon: IconCar, tone: 'orange' },
  fare_charged: { title: 'Fare charged', Icon: IconCard, tone: 'purple' },
  payment_failed: { title: 'Payment failed', Icon: IconCard, tone: 'danger' },
  payment_retry: { title: 'Retry payment', Icon: IconCard, tone: 'orange' },
  friend_joined: { title: 'Friend joined', Icon: IconCarpool, tone: 'purple' },
  friend_left: { title: 'Friend left', Icon: IconCarpool, tone: 'orange' },
  carpool_booked: { title: 'Carpool booked', Icon: IconCarpool, tone: 'orange' },
  location_shared: { title: 'Location shared', Icon: IconShare, tone: 'purple' },
  system: { title: 'Update', Icon: IconBell, tone: 'purple' },
}

let externalPush = null

/** Imperative helper for non-React callers */
export function pushToast(toast) {
  if (typeof externalPush === 'function') return externalPush(toast)
  return null
}

export function ToastProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const timers = useRef(new Map())
  const prefsRef = useRef(loadLocalPrefs(user?.id))

  useEffect(() => {
    prefsRef.current = loadLocalPrefs(user?.id)
  }, [user?.id])

  /** Allow RideToastWatcher / Account to refresh in-memory prefs without remount */
  const setPrefsCache = useCallback((prefs) => {
    prefsRef.current = prefs
  }, [])

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback((toast) => {
    const kind = toast?.kind || 'system'
    const cat = toast?.category || categoryForToastKind(kind)
    const prefs = prefsRef.current || loadLocalPrefs(user?.id)
    const critical = kind === 'canceled_midride' || toast?.force === true
    if (!critical && prefs[cat] === false) return null

    const id = toast.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (shouldPlayAlertTone(kind, prefs)) playAlertTone()
    const meta = KIND_META[kind] || KIND_META.system
    const entry = {
      id,
      kind,
      category: cat,
      title: toast.title || meta.title,
      body: toast.body || '',
      tone: toast.tone || meta.tone,
      Icon: toast.Icon || meta.Icon,
      createdAt: Date.now(),
    }
    setItems((prev) => {
      if (prev.some((t) => t.id === id)) return prev
      const next = [...prev, entry]
      // Keep queue bounded; drop oldest beyond MAX_VISIBLE + buffer
      return next.slice(-MAX_VISIBLE - 6)
    })
    const timer = setTimeout(() => dismiss(id), toast.durationMs ?? AUTO_MS)
    timers.current.set(id, timer)
    return id
  }, [dismiss, user?.id])

  useEffect(() => {
    externalPush = push
    return () => {
      if (externalPush === push) externalPush = null
    }
  }, [push])

  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
  }, [])

  const value = useMemo(
    () => ({ pushToast: push, dismissToast: dismiss, setPrefsCache, toasts: items }),
    [push, dismiss, setPrefsCache, items],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  )
}

export function ToastStack() {
  const ctx = useContext(ToastContext)
  const items = ctx?.toasts || []
  const dismiss = ctx?.dismissToast || (() => {})
  const visible = items.slice(-MAX_VISIBLE)
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {visible.map((t) => {
        const Icon = t.Icon || IconBell
        return (
          <div key={t.id} className={`toast-item toast-item--${t.tone || 'purple'}`} role="status">
            <div className="toast-icon">
              <Icon size={20} />
            </div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.body ? <div className="toast-text">{t.body}</div> : null}
            </div>
            <button
              type="button"
              className="toast-dismiss pressable"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <IconClose size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function useToasts() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return {
      pushToast: pushToast,
      dismissToast: () => {},
      setPrefsCache: () => {},
      toasts: [],
    }
  }
  return ctx
}
