/**
 * Driver application quiz.
 * A car and insurance are required. Student status is optional.
 */

export function driverQuizError({ hasCar, hasInsurance, attestation } = {}) {
  if (hasCar !== true) return 'A car is required to apply as a driver.'
  if (hasInsurance !== true) return 'Current auto insurance is required.'
  if (attestation !== true) return 'Confirm that you carry valid auto insurance.'
  return null
}

export function driverQuizPayload({ isStudent, hasCar, hasInsurance, wantsExtraMoney, attestationAccepted } = {}) {
  return {
    isStudent: isStudent === true,
    hasCar: hasCar === true,
    hasInsurance: hasInsurance === true,
    wantsExtraMoney: wantsExtraMoney === true,
    attestationAccepted: attestationAccepted === true,
  }
}
