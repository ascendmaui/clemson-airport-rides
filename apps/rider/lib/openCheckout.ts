import * as WebBrowser from 'expo-web-browser'

/** Stripe Checkout needs an https return URL. The rider confirms the deposit from payments after the browser closes. */
export function openStripeCheckout(url: string) {
  return WebBrowser.openBrowserAsync(url)
}
