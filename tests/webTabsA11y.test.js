import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import {
  getTabProps,
  getTabPanelProps,
  handleTabListKeyDown,
} from '../src/lib/tabA11y.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('getTabProps and getTabPanelProps return correct WAI-ARIA tab attributes', () => {
  // Selected tab
  const selTab = getTabProps('profile', 'profile')
  assert.equal(selTab.id, 'tab-profile')
  assert.equal(selTab.role, 'tab')
  assert.equal(selTab['aria-selected'], true)
  assert.equal(selTab['aria-controls'], 'tabpanel-profile')
  assert.equal(selTab.tabIndex, 0, 'selected tab has tabIndex 0')

  // Unselected tab has roving tabIndex -1
  const unselTab = getTabProps('billing', 'profile')
  assert.equal(unselTab.id, 'tab-billing')
  assert.equal(unselTab.role, 'tab')
  assert.equal(unselTab['aria-selected'], false)
  assert.equal(unselTab['aria-controls'], 'tabpanel-billing')
  assert.equal(unselTab.tabIndex, -1, 'unselected tab has roving tabIndex -1')

  // Tabpanel props
  const panel = getTabPanelProps('profile')
  assert.equal(panel.id, 'tabpanel-profile')
  assert.equal(panel.role, 'tabpanel')
  assert.equal(panel['aria-labelledby'], 'tab-profile')
  assert.equal(panel.tabIndex, 0, 'tabpanel container has tabIndex 0')
})

test('handleTabListKeyDown cycles tabs circularly with Arrow keys, Home, and End', () => {
  const tabs = [{ id: 'profile' }, { id: 'billing' }, { id: 'settings' }]
  let selected = null
  let prevented = false
  const fakeEvent = (key) => ({
    key,
    preventDefault: () => { prevented = true },
  })

  // ArrowRight: next
  prevented = false
  handleTabListKeyDown(fakeEvent('ArrowRight'), tabs, 'profile', (id) => { selected = id })
  assert.equal(selected, 'billing')
  assert.equal(prevented, true)

  // ArrowRight at last tab wraps to first
  prevented = false
  handleTabListKeyDown(fakeEvent('ArrowRight'), tabs, 'settings', (id) => { selected = id })
  assert.equal(selected, 'profile')
  assert.equal(prevented, true)

  // ArrowLeft at first tab wraps to last
  prevented = false
  handleTabListKeyDown(fakeEvent('ArrowLeft'), tabs, 'profile', (id) => { selected = id })
  assert.equal(selected, 'settings')
  assert.equal(prevented, true)

  // Home key goes to first
  prevented = false
  handleTabListKeyDown(fakeEvent('Home'), tabs, 'settings', (id) => { selected = id })
  assert.equal(selected, 'profile')
  assert.equal(prevented, true)

  // End key goes to last
  prevented = false
  handleTabListKeyDown(fakeEvent('End'), tabs, 'profile', (id) => { selected = id })
  assert.equal(selected, 'settings')
  assert.equal(prevented, true)

  // Other keys ignored
  selected = null
  prevented = false
  handleTabListKeyDown(fakeEvent('Enter'), tabs, 'profile', (id) => { selected = id })
  assert.equal(selected, null)
  assert.equal(prevented, false)
})

test('AccountScreenImpl.jsx implements WAI-ARIA tablist roving tabindex and tabpanel container', () => {
  const code = readSource('src/screens/AccountScreenImpl.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'AccountScreenImpl parses cleanly')

  // Tablist
  assert.match(code, /role="tablist"/, 'nav declares role="tablist"')
  assert.match(code, /onKeyDown=\{.*handleTabListKeyDown/, 'wires handleTabListKeyDown for arrow key navigation')

  // Tab buttons
  assert.match(code, /id=\{`tab-\$\{n\.id\}`\}/, 'tab has unique id')
  assert.match(code, /role="tab"/, 'declares role="tab"')
  assert.match(code, /aria-selected=\{on\}/, 'wires aria-selected')
  assert.match(code, /aria-controls=\{`tabpanel-\$\{n\.id\}`\}/, 'wires aria-controls')
  assert.match(code, /tabIndex=\{on\s*\?\s*0\s*:\s*-1\}/, 'wires roving tabIndex')

  // Tabpanel
  assert.match(code, /role="tabpanel"/, 'content container declares role="tabpanel"')
  assert.match(code, /id=\{`tabpanel-\$\{tab\}`\}/, 'tabpanel has matching id')
  assert.match(code, /aria-labelledby=\{`tab-\$\{tab\}`\}/, 'tabpanel labeled by active tab id')
})

test('BottomTabs.jsx implements keyboard arrow navigation and accessible icons', () => {
  const code = readSource('src/components/BottomTabs.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'BottomTabs parses cleanly')

  assert.match(code, /aria-label="Main"/, 'declares aria-label="Main"')
  assert.match(code, /aria-current=\{isActive\s*\?\s*['"]page['"]\s*:\s*undefined\}/, 'declares aria-current="page"')
  assert.match(code, /onKeyDown=\{handleKeyDown\}/, 'wires keyboard navigation')
  assert.match(code, /aria-hidden="true"/, 'decorative icon marked aria-hidden')
})
