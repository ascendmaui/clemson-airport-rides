/** True when this browser can pay with Apple Pay. */
export function webApplePaySetUp() {
  try {
    return typeof window !== 'undefined' && window.ApplePaySession?.canMakePayments?.() === true
  } catch {
    return false
  }
}
