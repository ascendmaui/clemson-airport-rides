import { useId, useState } from 'react'
import { MarketingPhoto } from './MarketingPhoto'

export function StatusPill({ status }) {
  switch (status) {
    case 'live':
      return <span className="mkt-live">Live</span>
    case 'coming':
      return <span className="mkt-soon">Coming soon</span>
    default: {
      const unexpected = status
      throw new Error(`Unexpected feature status: ${String(unexpected)}`)
    }
  }
}

export function FeatureBlock({ feature, onBook }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <article className="mkt-card mkt-feature mkt-peace">
      {feature.imageId ? <MarketingPhoto id={feature.imageId} /> : null}
      <StatusPill status={feature.status} />
      <h3>{feature.title}</h3>
      <p><strong>What it is. </strong>{feature.what}</p>
      <p className="mkt-why"><strong>Why it matters. </strong>{feature.why}</p>
      <button
        type="button"
        className="mkt-expand pressable"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide how it works' : 'How it works'}
      </button>
      <div id={panelId} className="mkt-expand-panel" hidden={!open}>
        <p><strong>How it works. </strong>{feature.how}</p>
      </div>
      {onBook ? (
        <button type="button" className="mkt-text pressable" onClick={onBook}>
          Book
        </button>
      ) : null}
    </article>
  )
}
