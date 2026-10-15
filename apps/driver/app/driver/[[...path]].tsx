import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'

function segmentsOf(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value) return [value]
  return []
}

/** https://clemsonrides.com/driver and /driver/* open the driver app. */
export default function DriverUniversalLink() {
  const router = useRouter()
  const params = useLocalSearchParams<{ path?: string | string[] }>()
  useEffect(() => {
    const [head, second] = segmentsOf(params.path)
    if (head === 'trip' && second) {
      router.replace({ pathname: '/trip', params: { id: second } })
      return
    }
    if (head === 'onboarding') {
      router.replace('/onboarding')
      return
    }
    if (head === 'sign-in') {
      router.replace('/sign-in')
      return
    }
    if (head === 'auth' && second === 'callback') {
      router.replace('/auth/callback')
      return
    }
    router.replace('/')
  }, [params.path, router])
  return null
}
