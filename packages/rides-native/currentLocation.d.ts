export function captureCurrentLocationPickup(
  ask: () => Promise<boolean> | boolean,
  readFix: () => Promise<{ lat: number; lng: number; ok?: boolean; reason?: string } | null>,
): Promise<
  | { ok: true; place: { label: string; lat: number; lng: number } }
  | { ok: false; reason: 'denied' | 'unavailable' }
>
