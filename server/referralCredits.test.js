import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  REFERRAL_REFEREE_CENTS,
  REFERRAL_REFERRER_CENTS,
  firstNameOnly,
  formatCreditCents,
  isValidReferralCode,
  normalizeReferralCode,
  referralPath,
} from './referralCredits.js'

test('credit amounts match the SQL grant defaults', () => {
  const sql = readFileSync(new URL('../supabase/referrals_credit_ledger.sql', import.meta.url), 'utf8')
  assert.ok(REFERRAL_REFERRER_CENTS > 0)
  assert.ok(REFERRAL_REFEREE_CENTS > 0)
  assert.match(sql, new RegExp(`REFERRAL_REFERRER_CENTS=${REFERRAL_REFERRER_CENTS}`))
  assert.match(sql, new RegExp(`REFERRAL_REFEREE_CENTS=${REFERRAL_REFEREE_CENTS}`))
  assert.match(sql, new RegExp(`p_referrer_cents integer DEFAULT ${REFERRAL_REFERRER_CENTS}`))
  assert.match(sql, new RegExp(`p_referee_cents integer DEFAULT ${REFERRAL_REFEREE_CENTS}`))
})

test('one welcome grant per new user is documented for social promo', () => {
  const sql = readFileSync(new URL('../supabase/referrals_credit_ledger.sql', import.meta.url), 'utf8')
  const contract = readFileSync(new URL('./signupReward.js', import.meta.url), 'utf8')
  assert.match(sql, /One reward grant per new user/)
  assert.match(sql, /claim_signup_reward/)
  assert.match(sql, /social_promo/)
  assert.match(sql, /signup_already_rewarded/)
  assert.match(contract, /ONE REWARD GRANT PER NEW USER/)
  assert.match(contract, /credit_ledger/)
  assert.match(contract, /rider_credit_ledger/)
})

test('formatCreditCents', () => {
  assert.equal(formatCreditCents(1000), '$10.00')
  assert.equal(formatCreditCents(0), '$0.00')
  assert.equal(formatCreditCents(-250), '-$2.50')
  assert.equal(formatCreditCents(5), '$0.05')
})

test('firstNameOnly hides the rest of the name', () => {
  assert.equal(firstNameOnly('Ada Lovelace'), 'Ada')
  assert.equal(firstNameOnly('  Prince  '), 'Prince')
  assert.equal(firstNameOnly('Mary-Jane Watson'), 'Mary-Jane')
  assert.equal(firstNameOnly('ada@clemson.edu'), 'Friend')
  assert.equal(firstNameOnly(''), 'Friend')
  assert.equal(firstNameOnly(null), 'Friend')
})

test('normalizeReferralCode accepts links and bare bodies', () => {
  assert.equal(normalizeReferralCode(' tgr-7k2mqx '), 'TGR-7K2MQX')
  assert.equal(normalizeReferralCode('7K2MQX'), 'TGR-7K2MQX')
  assert.equal(
    normalizeReferralCode('https://clemson-airport-rides.vercel.app/r/TGR-7K2MQX'),
    'TGR-7K2MQX',
  )
  assert.equal(normalizeReferralCode('https://example.com/?ref=TGR-7K2MQX'), 'TGR-7K2MQX')
  assert.equal(isValidReferralCode(normalizeReferralCode('7K2MQX')), true)
  assert.equal(isValidReferralCode('TGR-10IO'), false)
  assert.equal(referralPath('TGR-7K2MQX'), '/r/TGR-7K2MQX')
})
