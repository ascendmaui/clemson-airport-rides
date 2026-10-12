export type ToastTone = 'info' | 'success' | 'warning' | 'error'
export type ToastInput = {
  title: string
  body?: string | null
  tone?: ToastTone
  key?: string
  icon?: string | null
  durationMs?: number
  onPress?: () => void
}
export type Toast = Required<Pick<ToastInput, 'title'>> & {
  id: string
  key: string
  tone: ToastTone
  body: string | null
  icon: string | null
  durationMs: number
  onPress: (() => void) | null
}
export const TOAST_TONES: ToastTone[]
export const DEFAULT_TOAST_MS: number
export function showToast(input: ToastInput): string | null
export function dismissToast(id?: string): void
export function currentToast(): Toast | null
export function subscribeToasts(listener: (toast: Toast | null) => void): () => void
export function resetToasts(): void
