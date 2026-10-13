/** Rider note shared by the request body and the trips.rider_note column. */
export function rideRequestNote(note) {
  const cleaned = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)
  return {
    note: cleaned,
    rider_note: cleaned || null,
  }
}
