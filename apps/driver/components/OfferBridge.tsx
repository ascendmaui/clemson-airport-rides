/**
 * Local new-offer alert while the driver app is open, including off Driver Home.
 * Uses the existing local notification. Does not send a closed-app push.
 */
import { useEffect, useRef } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { notifyNewRequest, notifyScheduledBoard } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { loadDriverDesk, subscribeTrips } from 'rides-native/driverDesk'
import { clemsonMiamiDriverNotification } from 'rides-native/clemsonMiamiPromo.js'
import { isSyntheticOffer } from 'rides-native/syntheticOffers'
import { formatCents, type DriverCard } from 'rides-native/tripTags'

export function OfferBridge() {
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const seen = useRef(new Set<string>())
  const seenBoard = useRef(new Set<string>())
  const primed = useRef(false)
  const boardPrimed = useRef(false)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    primed.current = false
    boardPrimed.current = false
    seen.current = new Set()
    seenBoard.current = new Set()

    const look = async () => {
      try {
        const desk = await loadDriverDesk(supabase, user.id)
        if (!alive) return
        const board = desk.scheduledOpen || []
        if (!boardPrimed.current) {
          board.forEach((card: DriverCard) => seenBoard.current.add(card.id))
          boardPrimed.current = true
        } else {
          const freshBoard = board.filter((card: DriverCard) => !seenBoard.current.has(card.id))
          freshBoard.forEach((card: DriverCard) => seenBoard.current.add(card.id))
          const posted = freshBoard[0]
          if (posted) {
            AccessibilityInfo.announceForAccessibility(`Scheduled ride on the board. ${posted.pickupLabel} to ${posted.dropoffLabel}`)
            notifyScheduledBoard(posted).catch(() => {})
          }
        }
        const offers = (desk.offers || []).filter((card: DriverCard) => !isSyntheticOffer(card))
        if (!primed.current) {
          offers.forEach((card: DriverCard) => seen.current.add(card.id))
          primed.current = true
          return
        }
        const fresh = offers.filter((card: DriverCard) => !seen.current.has(card.id))
        fresh.forEach((card: DriverCard) => seen.current.add(card.id))
        const next = fresh[0]
        if (!next) return
        pulse('request')
        if (next.promoRide) {
          const note = clemsonMiamiDriverNotification()
          AccessibilityInfo.announceForAccessibility(`${note.title}. ${note.body}`)
        } else {
          AccessibilityInfo.announceForAccessibility(`New ride offer: ${formatCents(next.driverNetCents)}, pickup at ${next.pickupLabel}`)
        }
        notifyNewRequest(next).catch(() => {})
      } catch {
        /* desk reads can fail while signed out or offline */
      }
    }

    look()
    const unsubscribe = subscribeTrips(supabase, () => { look() })
    const poll = setInterval(look, 12000)
    return () => {
      alive = false
      unsubscribe()
      clearInterval(poll)
    }
  }, [pulse, user?.id])

  return null
}
