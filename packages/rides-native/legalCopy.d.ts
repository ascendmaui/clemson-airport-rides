export const LEGAL_UPDATED: string

export type LegalSection = {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
}

export const PRIVACY_SECTIONS: LegalSection[]
export const TERMS_SECTIONS: LegalSection[]
