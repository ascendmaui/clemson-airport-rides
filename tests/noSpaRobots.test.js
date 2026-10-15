import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Without a real file, /robots.txt falls through to the SPA and serves index.html,
// which Lighthouse SEO flags as an invalid robots.txt.
test('robots.txt is a real file, not the SPA fallback', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
  assert.doesNotMatch(robots, /<html/i)
  assert.match(robots, /^User-agent: \*/m)
  assert.match(robots, /^Disallow: \/api\//m)
  assert.match(robots, /^Sitemap: https:\/\/clemsonrides\.com\/sitemap\.xml$/m)
})

test('sitemap.xml lists the home page on clemsonrides.com', () => {
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8')
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  assert.match(sitemap, /<loc>https:\/\/clemsonrides\.com\/<\/loc>/)
})
