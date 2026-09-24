import { useSyncExternalStore } from 'react'

let engaged = false
const listeners = new Set<() => void>()

export function setSosEngaged(next: boolean) {
  if (engaged === next) return
  engaged = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSosEngaged() {
  return useSyncExternalStore(subscribe, () => engaged, () => false)
}
