import { Platform } from 'react-native'
import { initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native'
import {
  googlePayTestEnv,
  nativeSetupSheetParams,
  nativeWalletUnavailableCopy,
} from 'rides-native/riderMoney.js'
import type { NativeSetupResult, NativeSetupSheetInput } from '@/lib/nativePaymentSheetTypes'

export function nativePaymentSheetAvailable() {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}

function canceled(code: string | undefined) {
  return code === 'Canceled'
}

export async function presentNativeSetupSheet(input: NativeSetupSheetInput): Promise<NativeSetupResult> {
  const methodId = input.methodId
  const publishableKey = String(input.publishableKey || '')
  const merchantIdentifier = String(input.merchantIdentifier || process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER || '').trim()
  const merchantId = /^merchant\./.test(merchantIdentifier) ? merchantIdentifier : ''

  if (!publishableKey.startsWith('pk_')) {
    return { ok: false, unavailable: true, error: 'Stripe publishable key is not configured. No charge was made.' }
  }
  if (methodId === 'apple_pay' && Platform.OS !== 'ios') {
    return { ok: false, error: 'Apple Pay is available on iPhone. No charge was made.' }
  }
  if (methodId === 'google_pay' && Platform.OS !== 'android') {
    return { ok: false, error: 'Google Pay is available on Android. No charge was made.' }
  }

  const sheet = nativeSetupSheetParams(methodId, { testEnv: googlePayTestEnv(publishableKey) })
  if (sheet.applePay && methodId === 'apple_pay' && !merchantId) {
    return { ok: false, unavailable: true, error: nativeWalletUnavailableCopy('apple_pay') }
  }

  try {
    await initStripe({
      publishableKey,
      urlScheme: 'clemsonrides',
      setReturnUrlSchemeOnAndroid: true,
      ...(merchantId ? { merchantIdentifier: merchantId } : {}),
    })
    const initParams: Parameters<typeof initPaymentSheet>[0] = {
      merchantDisplayName: sheet.merchantDisplayName,
      returnURL: input.returnURL || sheet.returnURL,
      primaryButtonLabel: sheet.primaryButtonLabel,
      allowsDelayedPaymentMethods: sheet.allowsDelayedPaymentMethods,
      paymentMethodOrder: sheet.paymentMethodOrder,
      link: sheet.link,
      setupIntentClientSecret: input.clientSecret,
    }
    if (sheet.applePay && merchantId && Platform.OS === 'ios') initParams.applePay = sheet.applePay
    if (sheet.googlePay && Platform.OS === 'android') initParams.googlePay = sheet.googlePay
    const ready = await initPaymentSheet(initParams)
    if (ready.error) {
      if (canceled(ready.error.code)) return { ok: false, canceled: true }
      return { ok: false, error: ready.error.message || 'Could not open payment setup. No charge was made.' }
    }
    const presented = await presentPaymentSheet()
    if (presented.error) {
      if (canceled(presented.error.code)) return { ok: false, canceled: true }
      return { ok: false, error: presented.error.message || 'Could not save that payment method. No charge was made.' }
    }
    if (presented.didCancel) return { ok: false, canceled: true }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not open payment setup. No charge was made.'
    if (/native module|not implemented|unimplemented/i.test(message)) {
      return { ok: false, unavailable: true, error: message }
    }
    return { ok: false, error: message }
  }
}
