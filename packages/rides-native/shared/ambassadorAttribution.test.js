import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AMBASSADOR_CODE_TYPE,
  ambassadorCodeFromLocation,
  ambassadorLobbyCopy,
  ambassadorSavedCopy,
  attributionForUser,
  normalizeAmbassadorCode,
  packAttribution,
} from './ambassadorAttribution.js'

test('normalizes ambassador codes and rejects path words', () => {
  assert.equal(normalizeAmbassadorCode(' Amb_AbC-12 '), 'amb_abc12')
  assert.equal(normalizeAmbassadorCode('a'), '')
  assert.equal(normalizeAmbassadorCode('ambassador'), '')
  assert.equal(normalizeAmbassadorCode(''), '')
})

test('reads /a/:code from path, hash, and the app scheme', () => {
  assert.equal(ambassadorCodeFromLocation({ pathname: '/a/amb_tiger1' }), 'amb_tiger1')
  assert.equal(ambassadorCodeFromLocation({ hash: '#/a/amb_tiger1' }), 'amb_tiger1')
  assert.equal(ambassadorCodeFromLocation({ hash: '#/ambassador/Amb_Tiger2' }), 'amb_tiger2')
  assert.equal(
    ambassadorCodeFromLocation({ href: 'https://clemson-airport-rides.vercel.app/a/amb_tiger1' }),
    'amb_tiger1',
  )
  assert.equal(ambassadorCodeFromLocation({ href: 'clemsonrides://a/amb_tiger1' }), 'amb_tiger1')
  assert.equal(
    ambassadorCodeFromLocation({
      href: 'https://clemson-airport-rides.vercel.app/carpool/tok#/a/amb_hash',
    }),
    'amb_hash',
  )
  assert.equal(ambassadorCodeFromLocation({ pathname: '/ambassador' }), '')
  assert.equal(ambassadorCodeFromLocation({ pathname: '/carpool/amb_notalink' }), '')
  assert.equal(ambassadorCodeFromLocation({ pathname: '/api/carpool' }), '')
})

test('rider copy names the ambassador and does not promise money', () => {
  const lobby = ambassadorLobbyCopy('amb_tiger1')
  assert.equal(lobby.title, 'Referred by a campus ambassador')
  assert.equal(lobby.code_type, AMBASSADOR_CODE_TYPE)
  assert.match(lobby.body, /fare does not change/i)
  const saved = ambassadorSavedCopy()
  const blob = `${lobby.title} ${lobby.body} ${saved.title} ${saved.body}`
  assert.doesNotMatch(blob, /\$|1\.50|150|payout|credit|discount|free/i)
  assert.equal(ambassadorLobbyCopy(''), null)
  assert.equal(ambassadorLobbyCopy('ambassador'), null)
})

test('attribution stays on the signed-in rider', () => {
  const pending = packAttribution('AMB_tiger1', null)
  assert.equal(attributionForUser(pending, null)?.code, 'amb_tiger1')
  assert.equal(attributionForUser(pending, 'rider-1')?.code, 'amb_tiger1')

  const bound = packAttribution('amb_tiger1', 'rider-1')
  assert.equal(attributionForUser(bound, null), null)
  assert.equal(attributionForUser(bound, 'rider-2'), null)
  assert.equal(attributionForUser(bound, 'rider-1')?.code, 'amb_tiger1')
  assert.equal(attributionForUser('not-json-amb_tiger9', 'rider-1')?.userId, null)
})
