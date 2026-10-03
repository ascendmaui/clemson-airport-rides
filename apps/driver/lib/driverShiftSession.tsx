import { usePathname } from 'expo-router'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, AppState } from 'react-native'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { notifyNewRequest } from '@/lib/push'
import { playShiftSound } from '@/lib/shiftSounds'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { fetchDriverApplication, setDriverOnline } from 'rides-native/drivers'
import {
  loadDriverDesk,
  publishDriverCapacity,
  publishDriverLocation,
  subscribeTrips,
  type DriverDesk,
} from 'rides-native/driverDesk'
import { driverGateView } from 'rides-native/driverGateView'
import {
  desiredShift,
  onlineAfterLeave,
  quietSwitchOn,
  readShift,
  showOfferInTopBar,
} from 'rides-native/driverShift.js'
import { fetchNotificationPrefs, saveNotificationPrefs, type NotificationPrefs } from 'rides-native/notificationPrefs.js'
import { isSyntheticOffer } from 'rides-native/syntheticOffers'
import type { DriverCard } from 'rides-native/tripTags'

type ShiftContextValue = {
  ready: boolean
  online: boolean
  dnd: boolean
  canGoOnline: boolean
  self: { latitude: number; longitude: number } | null
  incomingOffer: DriverCard | null
  showOfferBanner: boolean
  error: string | null
  applyShift: (available: boolean) => void
  dismissIncoming: () => void
}

const ShiftContext = createContext<ShiftContextValue>({
  ready: false,
  online: false,
  dnd: false,
  canGoOnline: false,
  self: null,
  incomingOffer: null,
  showOfferBanner: false,
  error: null,
  applyShift: () => {},
  dismissIncoming: () => {},
})

export function useDriverShift() {
  return useContext(ShiftContext)
}

/**
 * Online shift lives above the navigator. Leaving Home, opening another screen,
 * or backgrounding the app must not write driver_status.online to false.
 */
export function DriverShiftProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [canGoOnline, setCanGoOnline] = useState(false)
  const [gateBody, setGateBody] = useState<string | null>(null)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [incomingOffer, setIncomingOffer] = useState<DriverCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const pathname = usePathname()
  const onDriverHome = pathname === '/' || pathname === '/index' || pathname === ''
  const availableRef = useRef(false)
  const approvedRef = useRef(false)
  const shiftTicket = useRef(0)
  const shiftChain = useRef(Promise.resolve())
  const shiftWriting = useRef(false)
  const prefsRef = useRef<NotificationPrefs | null>(null)
  const seenOffers = useRef(new Set<string>())
  const offersPrimed = useRef(false)
  const seatsRef = useRef<number | null>(null)
  const appActiveRef = useRef(appActive)
  appActiveRef.current = appActive

  const userId = user?.id

  const applyLoaded = useCallback((loaded: DriverDesk, dndValue: unknown, approved: boolean) => {
    if (shiftWriting.current) return
    const shift = readShift({ online: loaded.online, dnd: dndValue })
    const nextOnline = onlineAfterLeave(shift.available) && shift.available
    availableRef.current = nextOnline
    approvedRef.current = approved
    seatsRef.current = loaded.vehicle?.seats ?? null
    setOnline(nextOnline)
    setDnd(shift.dnd)
    if (loaded.lat != null && loaded.lng != null) {
      setSelf({ latitude: Number(loaded.lat), longitude: Number(loaded.lng) })
    }
    if (shift.reconcile && userId && supabase) {
      setDriverOnline(supabase, userId, false).catch(() => {})
    }
    const fresh = (loaded.offers || []).filter((card: DriverCard) => !isSyntheticOffer(card))
    if (!offersPrimed.current) {
      fresh.forEach((card: DriverCard) => seenOffers.current.add(card.id))
      offersPrimed.current = true
      return
    }
    const unseen = fresh.find((card: DriverCard) => !seenOffers.current.has(card.id))
    fresh.forEach((card: DriverCard) => seenOffers.current.add(card.id))
    if (!nextOnline) {
      setIncomingOffer(null)
      return
    }
    if (!unseen) {
      setIncomingOffer((current) => (current && fresh.some((card: DriverCard) => card.id === current.id) ? current : null))
      return
    }
    setIncomingOffer(unseen)
    pulse('request')
    notifyNewRequest(unseen).catch(() => {})
    if (appActiveRef.current) {
      AccessibilityInfo.announceForAccessibility(`New ride offer, pickup at ${unseen.pickupLabel}`)
    }
  }, [pulse, userId])

  const refresh = useCallback(async () => {
    if (!userId || !supabase) return
    const ticket = shiftTicket.current
    const application = await fetchDriverApplication(supabase, userId)
    if (ticket !== shiftTicket.current) return
    const status = application.application?.onboarding_status || 'none'
    const gate = driverGateView(status, { rejectionReason: application.application?.rejection_reason || null })
    setCanGoOnline(gate.canGoOnline)
    setGateBody(gate.body)
    approvedRef.current = status === 'approved'
    if (!gate.canSeeOffers) {
      setReady(true)
      return
    }
    const [loaded, prefsRes] = await Promise.all([
      loadDriverDesk(supabase, userId),
      fetchNotificationPrefs(supabase, authStorage, userId),
    ])
    if (ticket !== shiftTicket.current) return
    prefsRef.current = prefsRes.prefs
    applyLoaded(loaded, prefsRes.prefs.quiet?.dnd, status === 'approved')
    setReady(true)
  }, [applyLoaded, userId])

  useEffect(() => {
    offersPrimed.current = false
    seenOffers.current.clear()
    setReady(false)
    if (!userId) {
      availableRef.current = false
      setOnline(false)
      setDnd(false)
      setIncomingOffer(null)
      return undefined
    }
    refresh().catch(() => setReady(true))
    return undefined
  }, [refresh, userId])

  useEffect(() => {
    if (!supabase || !userId || !ready) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [ready, refresh, userId])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const active = next === 'active'
      setAppActive(active)
      if (active) refresh().catch(() => {})
    })
    return () => sub.remove()
  }, [refresh])

  useDriverLocation(Boolean(userId && ready && online), (fix) => {
    setSelf({ latitude: fix.lat, longitude: fix.lng })
    if (!supabase || !userId || !approvedRef.current) return
    publishDriverLocation(supabase, userId, { ...fix, online: availableRef.current }).catch(() => {})
  })

  const saveDnd = useCallback(async (dndOn: boolean, mine: number) => {
    if (!userId || !supabase || mine !== shiftTicket.current) return
    const base = prefsRef.current || (await fetchNotificationPrefs(supabase, authStorage, userId)).prefs
    if (mine !== shiftTicket.current) return
    const saved = await saveNotificationPrefs(supabase, authStorage, userId, {
      ...base,
      quiet: { ...base.quiet, dnd: dndOn },
    })
    if (mine !== shiftTicket.current) return
    prefsRef.current = saved.prefs
    setDnd(quietSwitchOn(saved.prefs.quiet.dnd))
  }, [userId])

  const applyShift = useCallback((nextAvailable: boolean) => {
    if (!userId || !supabase) return
    if (nextAvailable && !canGoOnline) {
      setError(gateBody || 'Finish approval before you start rides.')
      return
    }
    const next = desiredShift(nextAvailable)
    const sameAvailability = next.available === availableRef.current
    const sameDnd = next.dnd === quietSwitchOn(prefsRef.current?.quiet?.dnd)
    if (sameAvailability && sameDnd) return
    const mine = ++shiftTicket.current
    const previous = availableRef.current
    availableRef.current = next.available
    setOnline(next.available)
    setDnd(next.dnd)
    if (!sameAvailability) playShiftSound(next.available ? 'start' : 'stop')
    setError(null)
    shiftChain.current = shiftChain.current.then(async () => {
      if (mine !== shiftTicket.current || !supabase) return
      shiftWriting.current = true
      try {
        if (next.available) {
          await setDriverOnline(supabase, userId, true)
          if (mine !== shiftTicket.current) return
          await publishDriverCapacity(supabase, userId, seatsRef.current)
          await saveDnd(false, mine)
        } else {
          await saveDnd(true, mine)
          if (mine !== shiftTicket.current) return
          await setDriverOnline(supabase, userId, false)
        }
        if (mine !== shiftTicket.current) return
        pulse('online')
        AccessibilityInfo.announceForAccessibility(next.available ? 'You are now online' : 'You are now offline')
      } catch (err) {
        if (mine !== shiftTicket.current) return
        availableRef.current = previous
        setOnline(previous)
        setError(err instanceof Error ? err.message : 'Could not update online status')
      } finally {
        if (mine === shiftTicket.current) shiftWriting.current = false
      }
    }).catch(() => {})
  }, [canGoOnline, gateBody, pulse, saveDnd, userId])

  const dismissIncoming = useCallback(() => setIncomingOffer(null), [])

  const showOfferBanner = showOfferInTopBar({
    online,
    hasOffer: Boolean(incomingOffer),
    onDriverHome,
    appActive,
  })

  const value = useMemo<ShiftContextValue>(() => ({
    ready,
    online,
    dnd,
    canGoOnline,
    self,
    incomingOffer,
    showOfferBanner,
    error,
    applyShift,
    dismissIncoming,
  }), [applyShift, canGoOnline, dismissIncoming, dnd, error, incomingOffer, online, ready, self, showOfferBanner])

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
}
