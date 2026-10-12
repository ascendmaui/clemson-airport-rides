/**
 * Campus community layer: opt-in profile fields and match copy.
 * Off by default. Others only ever see a match line when BOTH people
 * turned that field on (server RPC community_matches). Never affects
 * matching, price, or ETA.
 */

export const COMMUNITY_FIELDS = Object.freeze([
  { key: 'hometown', share: 'share_hometown', label: 'Hometown', placeholder: 'Greenville, SC', example: 'Both from Greenville' },
  { key: 'greek_org', share: 'share_greek_org', label: 'Greek organization', placeholder: 'Sigma Nu', example: 'Both in Sigma Nu' },
  { key: 'major', share: 'share_major', label: 'Major', placeholder: 'Mechanical Engineering', example: 'Both study Mechanical Engineering' },
  { key: 'courses', share: 'share_courses', label: 'Classes (course codes only)', placeholder: 'CPSC 1010, ENGL 1030', example: 'Share a class' },
  { key: 'grad_year', share: 'share_grad_year', label: 'Grad year', placeholder: '2028', example: 'Both class of 2028' },
])

export const COMMUNITY_PRIVACY_NOTE = 'Optional and off by default. No one sees your answers. If you and your rider or driver both turn on the same field and it matches, you each see one line like "Both from Greenville." Class codes only, never times or schedules. This never changes matching, price, or ETA. Edit or remove anytime.'

export const EMPTY_COMMUNITY = Object.freeze({
  hometown: '', share_hometown: false,
  greek_org: '', share_greek_org: false,
  major: '', share_major: false,
  courses: [], share_courses: false,
  grad_year: null, share_grad_year: false,
})

function text(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, 60) : null
}

/** "cpsc1010, engl 1030" -> ['CPSC 1010', 'ENGL 1030']; anything with a time or section is dropped. */
export function parseCourses(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]+/)
  const out = []
  for (const item of raw) {
    const s = String(item).toUpperCase().replace(/\s+/g, ' ').trim()
    const m = s.match(/^([A-Z]{2,4}) ?(\d{4}[A-Z]?)$/)
    if (m && !out.includes(`${m[1]} ${m[2]}`)) out.push(`${m[1]} ${m[2]}`)
  }
  return out.slice(0, 8)
}

/** Row for public.community_profiles from the form (owner upsert). */
export function communityRow(userId, form = {}) {
  const year = Number(form.grad_year)
  const row = {
    user_id: userId,
    hometown: text(form.hometown),
    greek_org: text(form.greek_org),
    major: text(form.major),
    courses: parseCourses(form.courses),
    grad_year: Number.isInteger(year) && year >= 2000 && year <= 2040 ? year : null,
  }
  for (const f of COMMUNITY_FIELDS) {
    const has = f.key === 'courses' ? row.courses.length > 0 : row[f.key] != null
    row[f.share] = Boolean(form[f.share]) && has
  }
  return row
}

/** Clean list of match lines from the RPC. Only known categories, short labels. */
export function matchLines(rows) {
  const known = new Set(COMMUNITY_FIELDS.map((f) => f.key))
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && known.has(r.category) && typeof r.label === 'string')
    .map((r) => ({ category: r.category, label: r.label.slice(0, 80) }))
}
