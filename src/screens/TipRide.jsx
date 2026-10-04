import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { fetchTipOffer, recordTipChoice } from '../lib/riderTip'
import { formatUsdFromCents } from '../lib/pricing'
import { PrimaryButton } from '../components/PrimaryButton'
import { RequireAuth } from '../components/RequireAuth'
import { AccessibleAlert } from '../components/AccessibleAlert'

function TipBody() {
  const { user } = useAuth()
  const tripId = getHashRoute().params.trip
  const [offer, setOffer] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tripId || !user?.id) return undefined
    let alive = true
    setOffer(null)
    setError(null)
    fetchTipOffer(tripId)
      .then((data) => {
        if (!alive) return
        setOffer(data)
        const popular = data?.presets?.find((row) => row.popular)
        if (popular && !data?.choice && !(Number(data?.chargedTipCents) > 0)) setSelectedId(popular.id)
      })
      .catch((err) => {
        if (alive) setError(err.message || 'Could not load tip choices')
      })
    return () => {
      alive = false
    }
  }, [tripId, user?.id])

  if (!tripId) return <div style={{ padding: 24 }}>Missing trip</div>

  async function save(choiceId) {
    if (!tripId || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await recordTipChoice(tripId, choiceId)
      setOffer((prev) => ({
        ...(prev || {}),
        choice: data.choice,
        chargingWired: false,
        chargedTipCents: data.chargedTipCents || 0,
      }))
    } catch (err) {
      setError(err.message || 'Could not save tip choice')
    } finally {
      setBusy(false)
    }
  }

  function goRate() {
    navigate('rate', { trip: tripId })
  }

  const charged = Number(offer?.chargedTipCents) > 0
  const saved = offer?.choice
  const driverName = offer?.driverName || 'your driver'
  const presets = Array.isArray(offer?.presets) ? offer.presets : []

  return (
    <div className="fade-in tip-screen" data-testid="tip-screen">
      <div className="glass-panel glass-panel--elevated tip-card">
        <div className="tip-kicker">Trip complete</div>
        {!offer && !error && <p className="tip-copy">Loading tip choices…</p>}
        {charged && (
          <div role="status" data-testid="tip-already">
            <h1 className="tip-title">Tip already added</h1>
            <p className="tip-copy">
              {formatUsdFromCents(offer.chargedTipCents)} is already on this trip.
            </p>
            <div className="tip-actions">
              <PrimaryButton onClick={goRate}>Rate your driver</PrimaryButton>
            </div>
          </div>
        )}
        {!charged && saved && (
          <div role="status" data-testid="tip-saved">
            <h1 className="tip-title">{saved.skipped ? 'No tip this time' : 'Tip choice saved'}</h1>
            <p className="tip-copy">
              {saved.skipped
                ? 'You can still rate the ride.'
                : `${formatUsdFromCents(saved.tipCents)} is saved on this trip. Charging that tip is not available yet.`}
            </p>
            <div className="tip-actions">
              <PrimaryButton onClick={goRate}>Rate your driver</PrimaryButton>
            </div>
          </div>
        )}
        {!charged && !saved && offer && (
          <>
            <h1 className="tip-title">Add a tip for {driverName}</h1>
            <p className="tip-copy" data-testid="tip-uncharged-note">
              Pick an amount or skip. The price comes from this trip. Your card is not charged here.
            </p>
            <div className="tip-options" role="radiogroup" aria-label="Tip amount">
              {presets.map((preset) => {
                const selected = selectedId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`pressable tip-option${selected ? ' tip-option--selected' : ''}`}
                    data-testid={`tip-option-${preset.id}`}
                    disabled={busy}
                    onClick={() => setSelectedId(preset.id)}
                  >
                    {preset.popular ? <span className="tip-popular">Most common</span> : <span className="tip-popular tip-popular--spacer" aria-hidden="true" />}
                    <span className="tip-amount">{formatUsdFromCents(preset.cents)}</span>
                    {preset.percent != null ? <span className="tip-percent">{preset.percent}%</span> : <span className="tip-percent">Tip</span>}
                  </button>
                )
              })}
            </div>
            <div className="tip-actions">
              <PrimaryButton disabled={busy || !selectedId} onClick={() => selectedId && save(selectedId)}>
                {busy ? 'Saving…' : 'Add tip'}
              </PrimaryButton>
              <button
                type="button"
                className="pressable tip-skip"
                data-testid="tip-skip"
                disabled={busy}
                onClick={() => save('skip')}
              >
                No tip
              </button>
            </div>
          </>
        )}
        {error && (
          <AccessibleAlert
            error={error}
            onDismiss={() => setError(null)}
            onRetry={() => {
              setError(null)
              setOffer(null)
              fetchTipOffer(tripId).then(setOffer).catch((err) => setError(err.message || 'Could not load tip choices'))
            }}
            style={{ marginTop: 14 }}
          />
        )}
        {error && !offer && (
          <button type="button" className="pressable tip-skip" onClick={goRate}>
            Rate without a tip
          </button>
        )}
      </div>
    </div>
  )
}

export function TipRide() {
  return (
    <RequireAuth>
      <TipBody />
    </RequireAuth>
  )
}
