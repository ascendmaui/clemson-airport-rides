import { useEffect, useRef } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { pushToast } from '../lib/toasts'

function toastForChange(row, userId, prev) {
  if (!row?.id || !userId) return null
  const mine = row.reporter_id === userId
  const theirs = row.counterpart_id === userId
  if (!mine && !theirs) return null
  if (prev == null && theirs && row.status === 'open') {
    return {
      kind: 'ride_lost_found',
      title: 'Lost item reported',
      body: 'Open Lost & found to mark it found or not found.',
    }
  }
  if (prev == null) return null
  if (prev === row.status) return null
  if (mine && row.status === 'claimed') {
    return { kind: 'ride_lost_found', title: 'Item found', body: 'They confirmed it. Arrange the return in Lost & found.' }
  }
  if (mine && row.status === 'closed' && row.resolution === 'not_found') {
    return { kind: 'ride_lost_found', title: 'Item not found', body: 'The other person closed this lost-and-found report.' }
  }
  if (theirs && row.status === 'returned') {
    return { kind: 'ride_lost_found', title: 'Marked returned', body: 'The lost item was marked returned.' }
  }
  return null
}

export function LostFoundWatcher() {
  const { user } = useAuth()
  const seen = useRef(new Map())
  const primed = useRef(false)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    primed.current = false
    seen.current = new Map()

    function consider(row, { fromPrime = false } = {}) {
      if (!row?.id) return
      const prev = seen.current.has(row.id) ? seen.current.get(row.id) : null
      const known = seen.current.has(row.id)
      seen.current.set(row.id, row.status)
      if (fromPrime || !primed.current) return
      const toast = toastForChange(row, user.id, known ? prev : null)
      if (toast) pushToast(toast)
    }

    async function hydrate() {
      const { data, error } = await supabase
        .from('lost_found_reports')
        .select('id, status, resolution, reporter_id, counterpart_id')
        .or(`reporter_id.eq.${user.id},counterpart_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(20)
      if (!alive) return
      if (!error) (data || []).forEach((row) => consider(row, { fromPrime: true }))
      primed.current = true
    }

    hydrate()

    const channel = supabase
      .channel(`lost-found-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lost_found_reports' },
        (payload) => {
          const row = payload.new
          if (!row?.id) return
          if (row.reporter_id !== user.id && row.counterpart_id !== user.id) return
          consider(row)
        },
      )
      .subscribe()

    const poll = window.setInterval(() => {
      supabase
        .from('lost_found_reports')
        .select('id, status, resolution, reporter_id, counterpart_id')
        .or(`reporter_id.eq.${user.id},counterpart_id.eq.${user.id}`)
        .order('updated_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (!alive) return
          ;(data || []).forEach((row) => consider(row))
        })
    }, 25000)

    return () => {
      alive = false
      window.clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  return null
}
