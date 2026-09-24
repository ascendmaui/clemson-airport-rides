import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { loadStudentProfile, studentStatus } from 'rides-native/riderMoney.js'

type StudentPricing = ReturnType<typeof studentStatus>

function statusFor(user: { email?: string | null } | null | undefined, studentVerifiedAt?: string | null): StudentPricing {
  return studentStatus({
    email: user?.email,
    studentVerifiedAt,
    user,
  })
}

export function useStudentStatus(): StudentPricing {
  const { user } = useAuth()
  const [status, setStatus] = useState<StudentPricing>(() => statusFor(user))

  useFocusEffect(useCallback(() => {
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
  }, [user?.id, user?.email, user?.email_confirmed_at, user?.confirmed_at]))

  return status
}
