import { QrMark } from './QrMark'

/**
 * One ad slot as riders see it on the tablet. Image and video creatives play full bleed;
 * 'built' creatives render the Clemson Rides template from name, logo, deal text and QR.
 */
export function AdCreative({ creative, mediaSrc, onVideoEnd, preview = false }) {
  if (!creative) return null
  const src = mediaSrc || creative.mediaUrl || creative.media_url
  const qr = creative.qrUrl || creative.qr_url
  const deal = creative.dealText || creative.deal_text
  const logo = creative.logoUrl || creative.logo_url
  const theme = creative.theme || 'purple'
  const qrBlock = qr ? (
    <div className="adc-qr">
      <QrMark value={qr} label={`Scan for the deal from ${creative.headline || 'this business'}`} color="#1b1325" />
      <span>Scan for the deal</span>
    </div>
  ) : null
  if (creative.kind === 'image' && src) {
    return (
      <div className={`adc adc--media${preview ? ' adc--preview' : ''}`}>
        <img className="adc-media" src={src} alt={creative.headline || 'Local business ad'} />
        {qrBlock}
      </div>
    )
  }
  if (creative.kind === 'video' && src) {
    return (
      <div className={`adc adc--media${preview ? ' adc--preview' : ''}`}>
        <video className="adc-media" src={src} autoPlay muted playsInline loop={!onVideoEnd} onEnded={onVideoEnd} />
        {qrBlock}
      </div>
    )
  }
  return (
    <div className={`adc adc--built adc--${theme}${preview ? ' adc--preview' : ''}`} data-testid="adc-built">
      <div className="adc-copy">
        {logo ? <img className="adc-logo" src={logo} alt="" /> : null}
        <p className="adc-headline">{creative.headline || 'Your business'}</p>
        {deal ? <p className="adc-deal">{deal}</p> : null}
        <p className="adc-foot">Local partner · Clemson Rides</p>
      </div>
      {qrBlock}
    </div>
  )
}
