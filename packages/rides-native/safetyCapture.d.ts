export const MICROPHONE_DENIED: string
export const CAMERA_DENIED: string
export const CAMERA_NOT_READY: string

export function formatRecordingClock(startedAt: string | null | undefined, now?: number): string
export function recordingStatusLine(mode: string | null | undefined, startedAt: string | null | undefined, now?: number): string
export function localClipName(mode: string, at?: Date): string

export type AudioStart =
  | { ok: true; permission: 'granted'; startedAt: string }
  | { ok: false; permission: 'denied' | null; error: string }

export function startAudioCapture(input: {
  status?: string | null
  audio: {
    requestRecordingPermissionsAsync: () => Promise<{ granted?: boolean } | null | undefined>
    setAudioModeAsync: (options: { allowsRecording: boolean; playsInSilentMode: boolean }) => Promise<void>
    prepareToRecordAsync: (options: Record<string, unknown>) => Promise<void>
    record: () => void | Promise<void>
  }
  recordingOptions?: Record<string, unknown>
  now?: () => string
}): Promise<AudioStart>

export function stopAudioCapture(input: {
  stop: () => void | Promise<void>
  getUri: () => string | null | undefined
}): Promise<string>

export type ClipFile = { uri?: string }

export type DashcamStart =
  | { ok: true; permission: 'granted'; startedAt: string; pending: Promise<ClipFile | undefined>; arm?: undefined }
  | { ok: false; permission: 'granted'; arm: true; error?: undefined }
  | { ok: false; permission: 'granted' | 'denied' | null; error: string; arm?: undefined }

export function startDashcam(input: {
  status?: string | null
  camera: {
    requestCameraPermissionsAsync: () => Promise<{ granted?: boolean } | null | undefined>
    requestMicrophonePermissionsAsync: () => Promise<{ granted?: boolean } | null | undefined>
    ready?: boolean
    recordAsync?: () => Promise<ClipFile | undefined> | undefined
  }
  now?: () => string
}): Promise<DashcamStart>

export function stopDashcam(input: {
  stopRecording: () => void
  pending: Promise<ClipFile | undefined> | null | undefined
  persist?: (uri: string) => string | Promise<string>
}): Promise<string>

export type BackgroundPermission = 'granted' | 'denied' | 'unsupported' | 'unknown'

export function backgroundLocationStatusLine(permission: BackgroundPermission): string

export function readBackgroundLocationPermission(input: {
  platform: string
  getBackgroundPermissionsAsync: () => Promise<{ granted?: boolean; status?: string }>
}): Promise<Exclude<BackgroundPermission, 'unknown'>>

export type TripShareLink = { id: string; url: string; token?: string; active?: boolean }

export type TripShareToggle = {
  ok: boolean
  enabled: boolean
  share: TripShareLink | null
  note?: string
  error?: string
}

export function toggleDriverTripShare(input: {
  enabled: boolean
  trip: {
    id?: string | null
    status?: string | null
    riderId?: string | null
    pickupLabel?: string | null
    dropoffLabel?: string | null
  } | null
  share: TripShareLink | null
  createShare: (tripId: string, riderId: string) => Promise<TripShareLink>
  revokeShare: (shareId: string) => Promise<void> | void
  presentShare: (payload: { title: string; message: string; url: string }) => Promise<{ action?: string } | void> | { action?: string } | void
}): Promise<TripShareToggle>
