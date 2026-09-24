import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { loadStudentProfile, studentStatus } from 'rides-native/riderMoney.js'

type StudentPricing = ReturnType<typeof studentStatus>

export function useStudentStatus(): StudentPricing {
  const { user } = useAuth()
  const [status, setStatus] = useState<StudentPricing>(() => studentStatus({ email: user?.email }))

  useFocusEffect(useCallback(() => {
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
  }, [user?.id, user?.email]))

  return status
}
