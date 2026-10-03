export const VEHICLE_PHOTO_KINDS: { id: VehiclePhotoKind; label: string; hint: string }[]
export const MAX_VEHICLE_PHOTOS: number
export const VEHICLE_PHOTO_MAX_BYTES: number
export const VEHICLE_PHOTO_BUCKET: string

export type VehiclePhotoKind = 'exterior' | 'interior' | 'other'
export type VehiclePhotoSource = 'extra' | 'angle'

export type VehiclePhoto = {
  id: string
  profile_id?: string
  storage_path: string
  kind: string
  label: string
  url: string | null
  created_at?: string | null
  source: VehiclePhotoSource
}

export function isVehiclePhotoKind(kind: string): kind is VehiclePhotoKind
export function vehiclePhotoKindLabel(kind: string): string
export function assertVehiclePhotoFile(file: { uri?: string; name?: string; mimeType?: string; type?: string; size?: number; fileSize?: number; arrayBuffer?: () => Promise<ArrayBuffer> }): void

export function listVehiclePhotos(supabase: unknown, userId: string): Promise<VehiclePhoto[]>
export function listAnglePhotos(supabase: unknown, userId: string): Promise<VehiclePhoto[]>
export function listProfileVehiclePhotos(supabase: unknown, userId: string): Promise<VehiclePhoto[]>
export function uploadVehiclePhoto(
  supabase: unknown,
  userId: string,
  kind: VehiclePhotoKind,
  file: { uri?: string; name?: string; mimeType?: string; type?: string; size?: number; fileSize?: number; arrayBuffer?: () => Promise<ArrayBuffer> },
): Promise<VehiclePhoto>
export function removeVehiclePhoto(
  supabase: unknown,
  userId: string,
  photo: { id?: string; storage_path?: string; source?: VehiclePhotoSource },
): Promise<void>
