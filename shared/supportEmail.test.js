import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from './legalCopy.js'
import {
  DEFAULT_SUPPORT_EMAIL,
  SUPPORT_EMAIL,
  supportEmail,
  supportMailto,
} from './productLinks.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NEEDLE = 'rides@clemsonrides.com'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'coverage') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function allowed(relative) {
  if (relative === 'shared/productLinks.js') return true
  if (relative.startsWith(`docs${path.sep}`) || relative.startsWith('docs/')) return true
  if (/\.test\.(js|mjs|cjs|ts|tsx)$/.test(relative)) return true
  if (relative.endsWith('.md') || relative.endsWith('.snapshot') || relative.endsWith('.example')) return true
  return false
}

test('SUPPORT_EMAIL defaults to the Hostinger mailbox and can be overridden', () => {
  assert.equal(DEFAULT_SUPPORT_EMAIL, NEEDLE)
  assert.equal(SUPPORT_EMAIL, NEEDLE)
  assert.equal(supportEmail(), NEEDLE)
  assert.equal(supportEmail({}), NEEDLE)
  assert.equal(supportEmail({ SUPPORT_EMAIL: '  ' }), NEEDLE)
  assert.equal(supportEmail({ SUPPORT_EMAIL: 'not-an-email' }), NEEDLE)
  assert.equal(supportEmail({ SUPPORT_EMAIL: 'desk@example.com' }), 'desk@example.com')
  assert.equal(supportEmail({ VITE_SUPPORT_EMAIL: 'web@example.com' }), 'web@example.com')
  assert.equal(supportEmail({ EXPO_PUBLIC_SUPPORT_EMAIL: 'app@example.com' }), 'app@example.com')
  assert.equal(
    supportEmail({ SUPPORT_EMAIL: 'desk@example.com', VITE_SUPPORT_EMAIL: 'web@example.com' }),
    'desk@example.com',
  )
  assert.equal(supportMailto('Clemson Rides help'), `mailto:${NEEDLE}?subject=Clemson%20Rides%20help`)
})

test('privacy, terms, and the marketing chrome use the support mailbox', () => {
  const privacy = PRIVACY_SECTIONS.find((section) => section.heading === 'Article 12. Contact')
  const terms = TERMS_SECTIONS.find((section) => section.heading === 'Article 23. Notices and Contact')
  assert.match(privacy.paragraphs.join('\n'), new RegExp(NEEDLE.replace('.', '\\.')))
  assert.match(terms.paragraphs.join('\n'), new RegExp(NEEDLE.replace('.', '\\.')))
  const chrome = readFileSync(path.join(ROOT, 'src/components/MarketingChrome.jsx'), 'utf8')
  const info = readFileSync(path.join(ROOT, 'src/screens/MarketingInfo.jsx'), 'utf8')
  const legal = readFileSync(path.join(ROOT, 'src/screens/LegalPages.jsx'), 'utf8')
  const account = readFileSync(path.join(ROOT, 'apps/rider/app/(tabs)/account.tsx'), 'utf8')
  const driverMenu = readFileSync(path.join(ROOT, 'apps/driver/app/(tabs)/menu.tsx'), 'utf8')
  assert.match(chrome, /SupportMailLink/)
  assert.match(chrome, /mailto:\$\{email\}/)
  assert.match(info, /mailto:\$\{supportEmail\(\)\}/)
  assert.match(legal, /mailto:\$\{email\}/)
  assert.match(account, /supportMailto\(link\.mailSubject\)/)
  assert.match(driverMenu, /title: 'Help'/)
  assert.match(driverMenu, /title: 'Support'/)
  assert.match(driverMenu, /supportMailto\('Clemson Rides help'\)/)
  assert.match(driverMenu, /supportMailto\('Clemson Rides support'\)/)
})

test('production source keeps the mailbox in the shared constant', () => {
  const hits = []
  for (const file of walk(ROOT)) {
    const relative = path.relative(ROOT, file)
    if (allowed(relative)) continue
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|html|css|sql|toml|yml|yaml|json)$/.test(relative)) continue
    const text = readFileSync(file, 'utf8')
    if (text.includes(NEEDLE)) hits.push(relative)
  }
  assert.deepEqual(hits, [])
})
