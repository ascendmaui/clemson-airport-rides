import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import { loadStudentProfile, studentStatus } from '../../packages/rides-native/riderMoney.js'

function statusFor(user, studentVerifiedAt) {
  return studentStatus({
    email: user?.email,
    studentVerifiedAt,
    user,
  })
}

export function useStudentStatus() {
  const { user } = useAuth()
  const [status, setStatus] = useState(() => statusFor(user))

  useEffect(() => {
    let alive = true
    if (!user?.id || !supabase) {
      setStatus(statusFor(user))
      return () => {
        alive = false
      }
    }
    loadStudentProfile(supabase, user.id).then((row) => {
      if (!alive) return
      setStatus(statusFor(user, row.studentVerifiedAt))
    })
    return () => {
      alive = false
    }
  }, [user?.id, user?.email, user?.email_confirmed_at, user?.confirmed_at])

  return status
}
