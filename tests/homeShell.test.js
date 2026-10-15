import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { HOMEPAGE_HEADLINE, HOMEPAGE_SUBLINE } from '../src/content/differentiators.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('home shell is inlined into #root only for the marketing home', () => {
  const html = read('index.html')
  const vite = read('vite.config.js')
  assert.match(html, /<div id="root"><\/div>/)
  assert.match(html, /location\.pathname === '\/' && \(!h \|\| h === '#' \|\| h === '#\/'\)/)
  assert.match(html, /setAttribute\('data-home-shell', '1'\)/)
  assert.match(vite, /src\/shell\/homeShell\.html/)
  assert.match(vite, /plugins: \[react\(\), devApiPlugin\(\), homeShell\(\), deferEntryOnHomeShell\(\)\]/)
  const shell = read('src/shell/homeShell.html')
  assert.match(shell, /data-home-shell="" inert=""/)
  assert.match(shell, /frame\.remove\(\)/)
})

test('home shell matches the live hero copy and brand rules', () => {
  const shell = read('src/shell/homeShell.html')
  const home = read('src/screens/Marketing.jsx')
  const chrome = read('src/components/MarketingChrome.jsx')
  // If either assertion fails, the hero copy changed: refresh src/shell/homeShell.html from the rendered home.
  assert.equal(shell.match(/<h1>([^<]+)<\/h1>/)[1], HOMEPAGE_HEADLINE)
  assert.equal(shell.match(/<p class="mkt-lede">([^<]+)<\/p>/)[1], HOMEPAGE_SUBLINE)
  assert.match(home, /<h1>\{HOMEPAGE_HEADLINE\}<\/h1>/)
  for (const label of ['Book a ride', 'Book a carpool', 'Schedule for later', 'Download the app', 'Why Clemson Rides']) {
    assert.ok(shell.includes(`>${label}<`), label)
    assert.ok(home.includes(label), `Marketing.jsx dropped "${label}"`)
  }
  for (const label of ['Book', 'Drive', 'Get the App']) {
    assert.ok(shell.includes(`>${label}<`), label)
    assert.ok(chrome.includes(label), `MarketingChrome.jsx dropped "${label}"`)
  }
  assert.match(shell, /class="site-brand-word">Clemson Rides</)
  assert.doesNotMatch(shell, /Clemson RIDES/)
  assert.doesNotMatch(shell, /deposit|TestFlight|\bbeta\b/i)
})

test('every image the home shell references ships in public/', () => {
  const shell = read('src/shell/homeShell.html')
  const paths = new Set()
  for (const m of shell.matchAll(/(?:src|srcset)="([^"]+)"/g)) {
    for (const part of m[1].split(',')) paths.add(part.trim().split(/\s+/)[0])
  }
  assert.ok(paths.size >= 8)
  for (const p of paths) assert.ok(existsSync(new URL(`../public${p}`, import.meta.url)), `missing public${p}`)
})
