const ORANGE = '#F56600'
const PURPLE = '#522D80'

const ticket = {
  background: '#F7F4F0',
  borderRadius: 22,
  border: '1px solid rgba(82,45,128,0.18)',
  padding: 16,
}

function Banner({ model }) {
  const { banner, surge } = model
  return (
    <section aria-label={`${banner.kicker}. ${banner.title}. ${banner.countdownLabel ? `${banner.countdownLabel}. ` : ''}${banner.countdownCaption}`} style={ticket}>
      <div style={{ color: PURPLE, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>{banner.kicker}</div>
      <div style={{ color: '#241833', fontSize: 20, fontWeight: 800, marginTop: 4 }}>{banner.title}</div>
      {banner.countdownLabel ? (
        <div style={{ color: ORANGE, fontSize: 40, fontWeight: 700, letterSpacing: -1, marginTop: 4 }}>{banner.countdownLabel}</div>
      ) : null}
      <div style={{ color: '#5C516E', fontSize: 14, lineHeight: 1.45, marginTop: 4 }}>{banner.countdownCaption}</div>
      {banner.kickoffLabel ? (
        <div style={{ color: PURPLE, fontSize: 13, fontWeight: 700, marginTop: 4 }}>{banner.kickoffLabel}</div>
      ) : null}
      <div style={{ color: ORANGE, fontSize: 15, fontWeight: 800, marginTop: 8 }}>{surge.headline}</div>
    </section>
  )
}

function ZoneList({ title, rows, tone }) {
  if (!rows.length) return null
  return (
    <div>
      <div style={{ color: PURPLE, fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {rows.map((zone) => (
          <div key={zone.id} style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 3, borderRadius: 2, background: tone }} />
            <div>
              <div style={{ color: '#241833', fontSize: 16, fontWeight: 800 }}>{zone.name}</div>
              {zone.walkMinutes != null ? (
                <div style={{ color: ORANGE, fontSize: 12, fontWeight: 700 }}>{zone.walkMinutes} min walk</div>
              ) : null}
              <div style={{ color: '#5C516E', fontSize: 13, lineHeight: 1.45 }}>{zone.instructions}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GameDaySurgeNote({ model, audience = 'rider' }) {
  if (!model) return null
  const line = audience === 'driver' ? model.surge.driverLine : model.surge.riderLine
  return (
    <section aria-label={`${model.surge.headline}. ${line}`} style={{ ...ticket, marginTop: 8 }}>
      <div style={{ color: PURPLE, fontSize: 11, fontWeight: 800, letterSpacing: 1.2 }}>
        {audience === 'driver' ? 'BEFORE YOU GO ONLINE' : 'FARE'}
      </div>
      <div style={{ color: ORANGE, fontSize: 32, fontWeight: 700, letterSpacing: -0.6 }}>{model.surge.multiplierLabel}</div>
      <div style={{ color: '#241833', fontWeight: 800 }}>{model.surge.headline}</div>
      <p style={{ color: '#5C516E', fontSize: 14, lineHeight: 1.45, margin: '6px 0 0' }}>{line}</p>
      {model.surge.reasons.map((reason) => (
        <p key={reason} style={{ color: '#241833', fontSize: 13, lineHeight: 1.45, margin: '6px 0 0' }}>{reason}</p>
      ))}
    </section>
  )
}

export function GameDayBoard({ model, audience = 'rider', onTogglePrep }) {
  if (!model) return null
  const rider = audience === 'rider'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Banner model={model} />
      {rider ? (
        <section aria-label={`${model.zones.headline}. ${model.zones.body}`} style={{ ...ticket, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ color: '#241833', fontSize: 18, fontWeight: 800 }}>{model.zones.headline}</div>
          <div style={{ color: '#5C516E', fontSize: 13, lineHeight: 1.45 }}>{model.zones.body}</div>
          <ZoneList title="PICKUP" rows={model.zones.pickups} tone={ORANGE} />
          <ZoneList title="DROP-OFF" rows={model.zones.dropoffs} tone={PURPLE} />
        </section>
      ) : null}
      {rider && model.queue.visible ? (
        <section aria-label={`${model.queue.headline}. ${model.queue.detail}`} style={ticket}>
          <div style={{ color: PURPLE, fontSize: 11, fontWeight: 800, letterSpacing: 1.2 }}>PICKUP QUEUE</div>
          <div style={{ color: '#241833', fontSize: 18, fontWeight: 800, marginTop: 4 }}>{model.queue.headline}</div>
          {model.queue.waitLabel ? (
            <div style={{ color: ORANGE, fontSize: 32, fontWeight: 700 }}>{model.queue.waitLabel}</div>
          ) : null}
          <div style={{ color: '#5C516E', fontSize: 14, lineHeight: 1.45, marginTop: 4 }}>{model.queue.detail}</div>
        </section>
      ) : null}
      {!rider ? (
        <section aria-label={model.prep.headline} style={{ ...ticket, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ color: '#241833', fontSize: 18, fontWeight: 800 }}>{model.prep.headline}</div>
            <div style={{ color: ORANGE, fontSize: 13, fontWeight: 800 }}>{model.prep.progressLabel}</div>
          </div>
          {model.prep.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="pressable"
              aria-pressed={item.checked}
              aria-label={`${item.title}. ${item.detail}`}
              onClick={() => onTogglePrep?.(item.id)}
              style={{ display: 'flex', gap: 12, textAlign: 'left', background: 'transparent', padding: 0, border: 0, color: 'inherit' }}
            >
              <span style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                border: `2px solid ${item.checked ? ORANGE : PURPLE}`,
                background: item.checked ? ORANGE : 'transparent',
                flex: '0 0 auto',
                marginTop: 2,
              }} />
              <span>
                <span style={{ display: 'block', color: '#241833', fontSize: 15, fontWeight: 800 }}>{item.title}</span>
                <span style={{ display: 'block', color: '#5C516E', fontSize: 13, lineHeight: 1.45 }}>{item.detail}</span>
              </span>
            </button>
          ))}
        </section>
      ) : null}
      {!rider ? (
        <section aria-label={model.timeline.headline} style={{ ...ticket, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: '#241833', fontSize: 18, fontWeight: 800 }}>{model.timeline.headline}</div>
          <div style={{ color: '#5C516E', fontSize: 13, lineHeight: 1.45 }}>{model.timeline.body}</div>
          {model.timeline.windows.map((window) => (
            <div key={window.id} style={{ display: 'flex', gap: 10, opacity: window.state === 'past' ? 0.45 : 1 }}>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                marginTop: 4,
                background: window.state === 'now' || window.heat === 'peak' ? ORANGE : PURPLE,
              }} />
              <div>
                <div style={{ color: '#241833', fontSize: 15, fontWeight: 800 }}>{window.label}</div>
                <div style={{ color: ORANGE, fontSize: 12, fontWeight: 700 }}>{window.whenLabel} · {window.heatLabel}</div>
                <div style={{ color: '#5C516E', fontSize: 13, lineHeight: 1.45 }}>{window.note}</div>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      <GameDaySurgeNote model={model} audience={audience} />
    </div>
  )
}
