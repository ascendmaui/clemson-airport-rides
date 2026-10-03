export function quietSwitchOn(value: unknown): boolean

export function desiredShift(available: boolean): {
  available: boolean
  online: boolean
  dnd: boolean
}

export function readShift(input?: { online?: unknown; dnd?: unknown }): {
  available: boolean
  dnd: boolean
  reconcile: boolean
}

export function lookingForRides(input?: { available?: boolean; onTrip?: boolean }): boolean

export function onlineAfterLeave(wasOnline: boolean): boolean

export function showOfferInTopBar(input?: {
  online?: boolean
  hasOffer?: boolean
  onDriverHome?: boolean
  appActive?: boolean
}): boolean
