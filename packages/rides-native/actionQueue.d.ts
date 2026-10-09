export type QueuedDriverAction = {
  id: string
  tripId: string
  kind: 'status' | 'stop'
  op: string
  stopIndex?: number
  queuedAt: string
  attempts: number
}
export type ActionQueueState = {
  actions: QueuedDriverAction[]
  offline: boolean
  pending: number
  lastError: { action: QueuedDriverAction; message: string; code: string | null } | null
}
export type ActionOutcome =
  | { status: 'sent'; result: any }
  | { status: 'queued' }
  | { status: 'failed'; error: unknown }
  | { status: 'dropped'; error: unknown }
export type ActionQueueEvent =
  | { type: 'sent'; action: QueuedDriverAction; result: any }
  | { type: 'failed'; action: QueuedDriverAction; error: unknown; dropped: QueuedDriverAction[] }
export const QUEUE_STORAGE_KEY: string
export const QUEUEABLE_STATUS_OPS: readonly string[]
export const QUEUEABLE_STOP_OPS: readonly string[]
export function isOfflineError(err: unknown): boolean
export function retryDelayMs(attempts: number): number
export function newIdempotencyKey(now?: number, random?: () => number): string
export function isQueueableAction(action: unknown): boolean
export function projectTripStatus(status: string, actions?: Array<{ tripId?: string; kind: string; op: string }>, tripId?: string | null): string
export function waitingForSignalLabel(count: number): string | null
export type ActionQueue = {
  load(): Promise<void>
  submit(input: { kind: 'status' | 'stop'; tripId: string; op: string; stopIndex?: number }): Promise<ActionOutcome>
  flush(): Promise<void>
  forTrip(tripId: string): QueuedDriverAction[]
  state(): ActionQueueState
  clearError(): void
  dispose(): void
}
export function createActionQueue(options: {
  storage?: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem?(k: string): Promise<void> } | null
  send: (action: QueuedDriverAction) => Promise<any>
  onChange?: (state: ActionQueueState) => void
  onEvent?: (event: ActionQueueEvent) => void
  now?: () => number
  random?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  storageKey?: string
}): ActionQueue
