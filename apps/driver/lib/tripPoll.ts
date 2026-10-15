/**
 * The trip screen keeps one fallback poll behind realtime (subscribeTrips).
 * Each tick pulls the trip (and its heartbeat, which must keep running while the driver is in Maps)
 * and, only while the app is in the foreground, the rider's location fix.
 */
export const TRIP_FALLBACK_POLL_MS = 5000

export function tripPollTick(
  appState: string | null | undefined,
  pullTrip: () => unknown,
  pullRider?: (() => unknown) | null,
) {
  void pullTrip()
  if (appState === 'active' && pullRider) void pullRider()
}
