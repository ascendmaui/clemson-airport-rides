export type RideTypeIconName = 'car-outline' | 'time-outline' | 'sparkles-outline' | 'people-outline'
export const RIDE_TYPE_ICONS: Readonly<Record<string, RideTypeIconName>>
export function rideTypeIconName(id: string): RideTypeIconName
