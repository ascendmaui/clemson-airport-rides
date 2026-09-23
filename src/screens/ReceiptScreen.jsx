import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { fetchTripForRating } from '../lib/ratings'
import { RequireAuth } from '../components/RequireAuth'
import { buildReceiptText, shareReceipt } from '../lib/receiptText'
import { PrimaryButton } from '../components/PrimaryButton'

function ReceiptBody() {
  const { user } = useAuth()
  const tripId = getHashRoute().params.trip
  const [trip, setTrip] = useState(null)
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!tripId) return
    fetchTripForRating(tripId).then(setTrip).catch((e) => setError(e.message))
  }, [tripId])

  if (!tripId) return <div style={{ padding: 24 }}>Missing trip</div>
  if (error) return <div style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>
  if (!trip) return <div style={{ padding: 40, textAlign: 'center' }}>Loading receipt…</div>

  const forDriver = user?.id === trip.driver_id
  const text = buildReceiptText(trip, { forDriver })
  const url = `${window.location.origin}${window.location.pathname}#/receipt?trip=${encodeURIComponent(trip.id)}`

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 440, margin: '0 auto' }}>
      <div className="glass-panel glass-panel--elevated" style={{ padding: 22, borderRadius: 22 }}>
        <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>RECEIPT</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)', marginTop: 4 }}>Clemson RIDES</h1>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, marginTop: 14, lineHeight: 1.5 }}>
          {text}
        </pre>
        <PrimaryButton onClick={() => window.print()}>Print</PrimaryButton>
        <div style={{ height: 8 }} />
        <PrimaryButton
          variant="purple"
          onClick={async () => {
            const how = await shareReceipt(trip, { forDriver, url })
            if (how === 'copied') setMsg('Copied')
            else if (how === 'shared') setMsg('Shared')
          }}
        >
          Share
        </PrimaryButton>
        {msg && <p style={{ marginTop: 8, fontSize: 13 }}>{msg}</p>}
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('rate', { trip: trip.id })}
          style={{ display: 'block', width: '100%', marginTop: 12, fontWeight: 700, color: 'var(--purple)' }}
        >
          Back to trip
        </button>
      </div>
    </div>
  )
}

export function ReceiptScreen() {
  return (
    <RequireAuth>
      <ReceiptBody />
    </RequireAuth>
  )
}
