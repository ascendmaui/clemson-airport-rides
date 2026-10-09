export const HEARTBEAT_SOURCE: 'heartbeat'
export const GO_SOURCE: 'go'
export type PresenceFix = { lat: number; lng: number; heading: number | null }
export type PresenceWrite = PresenceFix & {
  online?: true
  onlineSource?: 'heartbeat'
  tripId: string | null
  tripStatus: string | null
}
export type PresenceSnapshot = {
  driverId: string | null
  intent: 'online' | 'offline' | null
  running: boolean
  trip: { id: string; status: string | null } | null
  generation: number
}
export type PresenceHeartbeat = {
  setDriver(id: string | null | undefined): void
  adoptServerOnline(online: boolean): void
  goOnline(): void
  goOffline(): void
  setTrip(trip: { id: string; status?: string | null } | null | undefined): void
  onFix(listener: (fix: PresenceFix) => void): () => void
  subscribe(listener: (state: PresenceSnapshot) => void): () => void
  restart(): void
  snapshot(): PresenceSnapshot
}
export function createPresenceHeartbeat(deps: {
  startPublisher: (onFix: (fix: PresenceFix) => Promise<void>) => (() => void) | void
  write: (
    driverId: string,
    fix: PresenceWrite,
    guards: { isCurrent: () => boolean; onlineIsCurrent: () => boolean },
  ) => Promise<void>
}): PresenceHeartbeat
