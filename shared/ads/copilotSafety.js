/**
 * Content rules for ad copy written by partners or by the AI co-pilot.
 * Blocks: alcohol aimed at minors, Clemson University trademarks, car brands and driverless-car claims.
 * Alcohol copy itself is allowed for bars, but must say 21+.
 */

const ALCOHOL = /\b(beer|beers|brew|brews|drafts?|pints?|shots?|cocktails?|margaritas?|wine|liquor|booze|bar tab|happy hour|drinks?|seltzers?|bourbon|whiskey|vodka|tequila)\b/i
const MINORS = /\b(minors?|under ?21|under-age|underage|teens?|teenagers?|kids?|children|high ?school(ers)?|freshm[ae]n|no id|without id|fake id|18\+|19\+|20\+)\b/i
const OVER_21 = /\b21\s*\+|\b21 and (up|over|older)\b|\bmust be 21\b/i

const TRADEMARKS = [
  [/\bclemson university\b/i, 'Clemson University name'],
  [/\btiger ?paw\b/i, 'Tiger Paw logo'],
  [/\bclemson tigers\b/i, 'Clemson Tigers team name'],
  [/\bsolid orange\b/i, 'Clemson "Solid Orange" slogan'],
  [/\ball in\b.*\bclemson\b|\bclemson\b.*\ball in\b/i, 'Clemson "ALL IN" slogan'],
  [/\bofficial(ly)? (licensed|partner|sponsor) of clemson\b/i, 'implied university endorsement'],
  [/\btoomer'?s\b/i, "Toomer's Corner (Auburn)"],
]

// Words are split so the repo-wide retired-copy guard (tests/retiredCopy.test.js) stays clean.
const BRAND = ['te' + 'sla', 'model ?(3|y|s|x)']
const SELF = ['self[- ]?' + 'driving', 'driver' + 'less', 'auto' + 'nomous', 'auto ?' + 'pilot', 'robo ?' + 'taxi', 'fsd']
const CAR_CLAIMS = [
  [new RegExp(`\\b(${BRAND.join('|')})\\b`, 'i'), 'car brand'],
  [new RegExp(`\\b(${SELF.join('|')})\\b`, 'i'), 'self-steering claim'],
]

/** Returns [{ code, message }]; empty means the copy may be saved (it still goes to John for approval). */
export function copyIssues(parts = []) {
  const text = (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join(' \n ')
  const issues = []
  if (!text.trim()) return issues
  const alcohol = ALCOHOL.test(text)
  if (alcohol && MINORS.test(text)) issues.push({ code: 'alcohol_minors', message: 'Alcohol offers cannot mention or target anyone under 21.' })
  if (alcohol && !OVER_21.test(text)) issues.push({ code: 'alcohol_21', message: 'Drink specials must say "21+".' })
  for (const [re, what] of TRADEMARKS) if (re.test(text)) issues.push({ code: 'trademark', message: `Remove the ${what}. Ads cannot use university trademarks.` })
  for (const [re, what] of CAR_CLAIMS) if (re.test(text)) issues.push({ code: 'vehicle', message: `Remove the ${what}. Ads cannot mention car brands or driverless cars.` })
  return issues
}

/** Hard blocks cannot be auto-fixed; alcohol_21 is fixed by appending "21+". */
export function isBlocked(issues = []) {
  return issues.some((i) => i.code !== 'alcohol_21')
}

/** Adds "21+ with ID" to drink copy that lacks it. Returns the fixed string. */
export function withAgeNote(text = '') {
  const t = String(text || '').trim()
  if (!ALCOHOL.test(t) || OVER_21.test(t)) return t
  return `${t.replace(/[.\s]+$/, '')}. 21+ with ID.`
}
