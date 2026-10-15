import { authedJson } from './apiClient.js'
export { PLAN_BADGE_COLOR, COVERED_LABEL, WEEKEND_CARPOOL_PLAN, formatUsd } from '../../shared/studentPlans.js'

const PATH = '/api/stripe-payment-methods?action=student-plans'

function call(supabase, body) {
  return authedJson(supabase, PATH, { method: 'POST', body })
}

/** { enabled: false } when the feature flag is off for this rider. */
export function loadStudentPlans(supabase) {
  return call(supabase, { op: 'status' })
}
export const requestStudentCode = (supabase) => call(supabase, { op: 'otp-request' })
export const verifyStudentCode = (supabase, code) => call(supabase, { op: 'otp-verify', code })
export const subscribeStudentPlan = (supabase, planId, interval) => call(supabase, { op: 'subscribe', planId, interval })
export const pauseStudentPlan = (supabase, kind, start, end) => call(supabase, { op: 'pause', kind, start, end })
export const resumeStudentPlan = (supabase) => call(supabase, { op: 'resume' })
export const cancelStudentPlan = (supabase) => call(supabase, { op: 'cancel' })
