import {
  LEGAL_UPDATED,
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
} from '../../shared/legalCopy.js'

// Freeze in place. These are the same objects shared/legalCopy.js exports, so a
// rider screen cannot rewrite a heading or push a section and change the policy
// the website reads in the same process.
function freezeSections(sections) {
  if (!Array.isArray(sections)) return
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue
    if (Array.isArray(section.paragraphs)) Object.freeze(section.paragraphs)
    if (Array.isArray(section.bullets)) Object.freeze(section.bullets)
    Object.freeze(section)
  }
  Object.freeze(sections)
}

freezeSections(PRIVACY_SECTIONS)
freezeSections(TERMS_SECTIONS)

export { LEGAL_UPDATED, PRIVACY_SECTIONS, TERMS_SECTIONS }
