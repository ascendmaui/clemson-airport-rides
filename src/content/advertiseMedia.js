/**
 * Media slots on /advertise. NOTHING is placed until John approves each asset.
 * Approved assets go in public/ads/ (served from the site, never hotlinked), then:
 *   - How it Works video: set HOW_IT_WORKS_VIDEO = { src: '/ads/how-it-works.mp4', poster: '/ads/how-it-works-poster.jpg' }
 *   - Hero rotating demo: set HERO_DEMO_APPROVED = true (plays the approved SAMPLE_ADS in a tablet frame)
 *   - Sample gallery: see src/content/sampleAds.js (SAMPLE_ADS_APPROVED)
 */
export const HOW_IT_WORKS_VIDEO = null
export const HERO_DEMO_APPROVED = false
