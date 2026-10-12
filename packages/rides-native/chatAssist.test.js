import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asAutoReply, containsMoneyPromise, detectIntent, estimateEtaMinutes, finalizeReply, isAutoReply, templateReply,
} from './chatAssist.js'

test('detects common rider questions', () => {
  const cases = {
    'how long till you get here?': 'eta',
    'eta?': 'eta',
    'where are you': 'location',
    'wya': 'location',
    'where should i meet you? which door': 'pickup_spot',
    'I have 2 big suitcases, is there room for that?': 'luggage',
    'what car are you in': 'car',
    'whats the plate': 'car',
    'do I tip in cash or the app?': 'payment_tip',
    'can I get a refund? I was overcharged': 'fare_refund',
    'how much will this cost': 'fare_refund',
  }
  for (const [text, intent] of Object.entries(cases)) assert.equal(detectIntent(text).intent, intent, text)
  assert.equal(detectIntent('thanks!').intent, null)
  assert.equal(detectIntent('').intent, null)
})

test('money/refund wins over other intents', () => {
  assert.equal(detectIntent('where are you, and will I get a refund?').intent, 'fare_refund')
})

test('templates use trip context and never quote money', () => {
  const ctx = { status: 'accepted', etaMinutes: 6, pickupLabel: 'Core Campus', vehicle: { color: 'White', make: 'Toyota', model: 'Camry', plate: 'ABC123' } }
  assert.match(templateReply('eta', ctx), /6 min/)
  assert.match(templateReply('car', ctx), /White Toyota Camry, plate ABC123/)
  assert.match(templateReply('pickup_spot', ctx), /Core Campus/)
  assert.match(templateReply('eta', { ...ctx, status: 'arrived' }), /I'm here/)
  for (const intent of ['eta', 'location', 'pickup_spot', 'luggage', 'car', 'payment_tip', 'fare_refund']) {
    assert.equal(containsMoneyPromise(templateReply(intent, ctx)), false, intent)
  }
})

test('guard blocks money promises', () => {
  assert.ok(containsMoneyPromise("Don't worry, I'll get you a refund"))
  assert.ok(containsMoneyPromise('It will be $25'))
  assert.ok(containsMoneyPromise('the fare is going down'.replace('is going', 'is')))
  assert.ok(containsMoneyPromise('This ride is free'))
  assert.equal(containsMoneyPromise('About 5 min out'), false)
})

test('finalizeReply: rejects unsafe LLM text, never auto-sends fare questions', () => {
  const t = templateReply('eta', { etaMinutes: 4 })
  assert.deepEqual(finalizeReply({ intent: 'eta', template: t, llmText: 'Be there in 4, and I will refund you $5' }), { text: t, source: 'template', autoSendable: true })
  assert.equal(finalizeReply({ intent: 'eta', template: t, llmText: 'Almost there, ~4 min!' }).source, 'llm')
  const fare = finalizeReply({ intent: 'fare_refund', template: templateReply('fare_refund'), llmText: 'Sure' })
  assert.equal(fare.autoSendable, false)
  assert.equal(fare.source, 'template')
})

test('auto-reply label and ETA estimate', () => {
  assert.ok(isAutoReply(asAutoReply('On my way')))
  assert.equal(asAutoReply('x'.repeat(600)).length, 500)
  const eta = estimateEtaMinutes({ lat: 34.6784, lng: -82.8397 }, { lat: 34.6836, lng: -82.8364 })
  assert.ok(eta >= 1 && eta <= 3)
  assert.equal(estimateEtaMinutes(null, { lat: 1, lng: 1 }), null)
})

test('assist endpoint: driver-only, template fallback without a key, refund never auto', async () => {
  const { default: handler } = await import('../../api/trip-messages.js')
  const TRIP = '11111111-1111-1111-1111-111111111111'
  const ctx = (body) => ({
    trip: { id: TRIP, status: 'accepted', rider_id: 'r', driver_id: 'd', pickup_label: 'Core Campus', pickup_lat: 34.6836, pickup_lng: -82.8364 },
    messages: [{ id: 'm1', sender_id: 'r', body }],
    driverLoc: { lat: 34.6784, lng: -82.8397 },
    vehicle: { color: 'Blue', make: 'Honda', model: 'Civic' },
  })
  const call = async (user, body, question) => {
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
    await handler({ method: 'POST', url: '/api/trip-messages?action=assist', headers: { 'x-forwarded-for': `t-${Math.random()}` }, body }, res, {
      sb: {}, user, loadAssistContext: async () => ctx(question), resolveLanguageModel: () => null,
    })
    return { status: res.statusCode, json: JSON.parse(res.body) }
  }
  assert.equal((await call({ id: 'r' }, { tripId: TRIP }, 'eta?')).status, 403)
  const eta = await call({ id: 'd' }, { tripId: TRIP }, 'how long till you get here?')
  assert.equal(eta.status, 200)
  assert.equal(eta.json.intent, 'eta')
  assert.equal(eta.json.suggestion.source, 'template')
  assert.equal(eta.json.suggestion.autoSendable, true)
  assert.match(eta.json.suggestion.text, /min/)
  const refund = await call({ id: 'd' }, { tripId: TRIP }, 'I want a refund')
  assert.equal(refund.json.intent, 'fare_refund')
  assert.equal(refund.json.suggestion.autoSendable, false)
  const none = await call({ id: 'd' }, { tripId: TRIP }, 'thanks!')
  assert.equal(none.json.suggestion, null)
})
