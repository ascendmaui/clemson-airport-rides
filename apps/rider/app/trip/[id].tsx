import { Redirect, useLocalSearchParams } from 'expo-router'

export default function TripIdLink() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>()
  const trip = Array.isArray(id) ? id[0] : id
  if (!trip) return <Redirect href="/" />
  return <Redirect href={{ pathname: '/requested', params: { trip } }} />
}
