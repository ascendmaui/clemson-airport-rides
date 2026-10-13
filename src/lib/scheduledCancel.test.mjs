import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

const key = '__scheduledCancelTest'
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith('/src/lib/scheduledRides.js')) return nextResolve(specifier, context)
    if (specifier === './supabase') return { shortCircuit: true, url: moduleUrl(`export const supabase = { from() { return globalThis.${key}.query } }`) }
    if (specifier === './payments') return { shortCircuit: true, url: moduleUrl(`export async function api(path, body) { const state = globalThis.${key}; state.calls.push({path,body}); if (state.error) throw state.error }; export function createServerScheduledTrip() {}`) }
    if (specifier === './rideBilling') return { shortCircuit: true, url: moduleUrl('export function fetchRideQuote() {}') }
    if (specifier === './scheduledRideModel') return nextResolve('./scheduledRideModel.js', context)
    return nextResolve(specifier, context)
  },
})
const { cancelScheduledTrip } = await import('./scheduledRides.js')

test('web scheduled cancel releases the hold after updating the trip and tolerates release failures', async () => {
  for (const error of [null, new Error('Release unavailable')]) {
    const patches = []
    const query = {
      update(patch) { patches.push(patch); return query }, eq() { return query }, in() { return query },
      select: async () => ({ data: [{ id: 'scheduled-1' }], error: null }),
    }
    globalThis[key] = { query, calls: [], error }
    await cancelScheduledTrip('scheduled-1')
    assert.equal(patches[0].status, 'canceled')
    assert.ok(patches[0].canceled_at)
    assert.deepEqual(globalThis[key].calls, [{ path: '/api/stripe-payment-methods?action=release-scheduled-boost', body: { tripId: 'scheduled-1' } }])
  }
})
