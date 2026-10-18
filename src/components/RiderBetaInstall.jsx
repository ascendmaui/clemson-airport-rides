import {
  RIDER_BETA_COPY,
  RIDER_BETA_QR_SRC,
  RIDER_BETA_SECTION_ID,
  RIDER_BETA_URL,
  TESTFLIGHT_APP_URL,
} from '../content/riderBeta.js'
import '../styles/riderBeta.css'

/**
 * Clemson Rides iPhone beta: a tappable Join button first, then a QR of the same
 * TestFlight link for desktop visitors to scan with a phone.
 */
export function RiderBetaInstall({ id = RIDER_BETA_SECTION_ID, className = '' }) {
  const headingId = `${id}-heading`
  return (
    <section id={id} className={`mkt-card rb-card ${className}`.trim()} aria-labelledby={headingId}>
      <div className="rb-copy">
        <p className="rb-kicker">{RIDER_BETA_COPY.kicker}</p>
        <h2 id={headingId}>{RIDER_BETA_COPY.title}</h2>
        <p className="rb-body">{RIDER_BETA_COPY.body}</p>
        <a className="rb-join pressable" href={RIDER_BETA_URL} target="_blank" rel="noopener">
          {RIDER_BETA_COPY.cta}
        </a>
        <a className="rb-testflight" href={TESTFLIGHT_APP_URL} target="_blank" rel="noopener">
          {RIDER_BETA_COPY.testflightLink}
        </a>
      </div>
      <figure className="rb-qr">
        <img src={RIDER_BETA_QR_SRC} alt={RIDER_BETA_COPY.qrAlt} width="220" height="220" decoding="async" />
        <figcaption>{RIDER_BETA_COPY.qrHint}</figcaption>
      </figure>
    </section>
  )
}
