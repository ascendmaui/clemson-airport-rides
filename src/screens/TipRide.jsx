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
  const [customText, setCustomText] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tripId || !user?.id) return undefined
    let alive = true
    setOffer(null)
    setSelectedId(null)
    setCustomText('')
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

  async function save(choiceId, customDollars) {
    if (!tripId || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await recordTipChoice(tripId, choiceId, customDollars)
      setOffer((prev) => ({
        ...(prev || {}),
        choice: data.choice,
        chargingWired: Boolean(data.chargingWired),
        chargedTipCents: data.chargedTipCents || (data.choice?.charged ? data.choice.tipCents : 0),
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

  function choosePreset(id) {
    setSelectedId(id)
    setCustomText('')
    setError(null)
  }

  function chooseCustom(nextText) {
    setCustomText(nextText)
    setSelectedId('custom')
    setError(null)
  }

  const charged = Number(offer?.chargedTipCents) > 0
  const saved = offer?.choice
  const driverName = offer?.driverName || 'your driver'
  const presets = Array.isArray(offer?.presets) ? offer.presets : []
  const customMin = Number(offer?.custom?.minCents)
  const customMax = Number(offer?.custom?.maxCents)
  const customRange = Number.isFinite(customMin) && Number.isFinite(customMax)
    ? `${formatUsdFromCents(customMin)} to ${formatUsdFromCents(customMax)}`
    : '$1.00 to $100.00'

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
                : saved.charged
                  ? `${formatUsdFromCents(saved.tipCents)} was charged to your saved card.`
                  : `${formatUsdFromCents(saved.tipCents)} is saved. No card was charged.`}
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
              Pick an amount, enter your own, or skip. The price comes from this trip. A saved card is charged after you add the tip. No card on file means nothing is charged.
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
                    onClick={() => choosePreset(preset.id)}
                  >
                    {preset.popular ? <span className="tip-popular">Most common</span> : <span className="tip-popular tip-popular--spacer" aria-hidden="true" />}
                    <span className="tip-amount">{formatUsdFromCents(preset.cents)}</span>
                    {preset.percent != null ? <span className="tip-percent">{preset.percent}%</span> : <span className="tip-percent">Tip</span>}
                  </button>
                )
              })}
            </div>
            <div className="tip-or" aria-hidden="true"><span>or</span></div>
            <div className={`tip-custom${selectedId === 'custom' ? ' tip-custom--selected' : ''}`}>
              <label className="tip-custom-label" htmlFor="tip-custom-amount">Custom amount</label>
              <div className="tip-custom-field">
                <span className="tip-custom-prefix" aria-hidden="true">$</span>
                <input
                  id="tip-custom-amount"
                  className="tip-custom-input"
                  data-testid="tip-custom-input"
                  inputMode="decimal"
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="0.00"
                  maxLength={16}
                  aria-label="Custom tip amount in dollars"
                  aria-describedby="tip-custom-hint"
                  aria-invalid={selectedId === 'custom' && error ? 'true' : undefined}
                  disabled={busy}
                  value={customText}
                  onFocus={() => setSelectedId('custom')}
                  onChange={(event) => chooseCustom(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    save('custom', customText)
                  }}
                />
              </div>
              <p id="tip-custom-hint" className="tip-custom-hint">
                Any amount from {customRange}. A saved card is charged after you add the tip.
              </p>
            </div>
            <div className="tip-actions">
              <PrimaryButton
                disabled={busy || !selectedId}
                onClick={() => {
                  if (selectedId === 'custom') save('custom', customText)
                  else if (selectedId) save(selectedId)
                }}
              >
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
            onRetry={offer ? undefined : () => {
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
