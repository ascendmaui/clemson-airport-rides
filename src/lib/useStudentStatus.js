import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import { loadStudentProfile, studentStatus } from '../../packages/rides-native/riderMoney.js'

export function useStudentStatus() {
  const { user } = useAuth()
  const [status, setStatus] = useState(() => studentStatus({ email: user?.email }))

  useEffect(() => {
    let alive = true
    if (!user?.id || !supabase) {
      setStatus(studentStatus({ email: user?.email }))
      return () => {
        alive = false
      }
    }
    loadStudentProfile(supabase, user.id).then((row) => {
      if (!alive) return
      setStatus(studentStatus({
        email: row.email || user.email,
        studentVerifiedAt: row.studentVerifiedAt,
      }))
    })
    return () => {
      alive = false
    }
  }, [user?.id, user?.email])

  return status
}
