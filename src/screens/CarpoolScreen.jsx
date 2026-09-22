import { FriendRideScreen } from './FriendRide'

/** Thin wrapper — carpool reuses FriendRide with kind=carpool. */
export function CarpoolScreen({ token }) {
  return <FriendRideScreen token={token || ''} kind="carpool" />
}
