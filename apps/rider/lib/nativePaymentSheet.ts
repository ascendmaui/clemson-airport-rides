import type { NativeSetupResult } from '@/lib/nativePaymentSheetTypes'

export function nativePaymentSheetAvailable() {
  return false
}

export async function presentNativeSetupSheet(): Promise<NativeSetupResult> {
  return {
    ok: false,
    unavailable: true,
    error: 'PaymentSheet is not available on this platform. No charge was made.',
  }
}
