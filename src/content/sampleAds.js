/**
 * Sample ads ("Run an ad similar to this") for the /advertise gallery and the Build My Ad templates.
 *
 * NOT LIVE: John approves each sample before it is placed. Until then SAMPLE_ADS_APPROVED stays
 * false and the gallery, the template picker and ?template= prefill render nothing.
 * To place approved samples: copy the approved entries (and their images from
 * /workspace/advertise-assets/samples/ into public/ads/samples/) into SAMPLE_ADS, then flip the flag.
 */
export const SAMPLE_ADS_APPROVED = false

/** { id, category, headline, dealText, theme, image?, video? } */
export const SAMPLE_ADS = []

export function approvedSamples(list = SAMPLE_ADS, approved = SAMPLE_ADS_APPROVED) {
  return approved ? list.filter((s) => s && s.id && s.headline) : []
}

export function sampleById(id, list = SAMPLE_ADS, approved = SAMPLE_ADS_APPROVED) {
  return approvedSamples(list, approved).find((s) => s.id === id) || null
}
