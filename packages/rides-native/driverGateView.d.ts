export const APPROVAL_GATE: string
export function approvalGateMessage(): string
export const ONBOARDING_STATUSES: readonly string[]

export type DriverGateView = {
  canGoOnline: boolean
  canSeeOffers: boolean
  title: string
  body: string
  primaryAction: string | null
}

export type DriverGateOptions = {
  rejectionReason?: string | null
  missingItems?: (string | { id?: string; label?: string })[] | string | null
}

export function driverGateView(
  onboardingStatus: string | null | undefined,
  options?: DriverGateOptions
): DriverGateView

export default driverGateView
