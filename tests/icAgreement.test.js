import assert from 'node:assert/strict'
import test from 'node:test'
import { agreementPlainParagraphs, IC_AGREEMENT_HTML, IC_AGREEMENT_VERSION, OPERATOR_NAME } from '../shared/icAgreement.js'

test('the contractor agreement is a deep company-protective template', () => {
  const words = agreementPlainParagraphs().join(' ').split(/\s+/).filter(Boolean)
  const pages = words.length / 500
  assert.ok(words.length > 6000, `expected a deep agreement, got ${words.length} words`)
  assert.ok(pages > 12, `expected more than 12 pages, got ${pages}`)
  assert.equal(IC_AGREEMENT_VERSION, 'ic-agreement-2026-09-24')
  assert.equal(OPERATOR_NAME, 'Clemson RIDES / Operator')
  const html = IC_AGREEMENT_HTML.toLowerCase()
  for (const phrase of [
    'independent contractor',
    'vicarious',
    'indemnif',
    'assumption of risk',
    'non-disparagement',
    'audit',
    'termination for convenience',
    'south carolina',
    'class',
    'arbitration',
  ]) {
    assert.ok(html.includes(phrase), phrase)
  }
  assert.match(IC_AGREEMENT_HTML, /template for counsel|not legal advice/i)
})
