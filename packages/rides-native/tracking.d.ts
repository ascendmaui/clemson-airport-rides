export const LOCATION_STALE_MS: number
export function trackingIssue(status: string | null | undefined, timestamp: string | null | undefined, now?: number): string | null
export function startLocationPublisher<T>(options: {
  locate: () => Promise<T>; publish: (fix: T) => Promise<unknown>;
  onFix: (fix: T) => void; onError: (error: string | null) => void;
  intervalMs?: number; timeoutMs?: number;
}): () => void

export function withTrackingTimeout<T>(promise: PromiseLike<T>, timeoutMs?: number): Promise<T>
