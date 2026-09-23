import { useEffect, useMemo, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PlacePicker } from '../components/PlacePicker'
import { PrimaryButton } from '../components/PrimaryButton'
import { CarpoolCompare } from '../components/CarpoolCompare'
import { useAuth } from '../lib/auth'
import {
  NEIGHBORHOODS,
  demandWindow,
  formatUsd,
  illustrativePeakAt,
  isGameWeek,
  pitchQuote,
} from '../lib/carpoolEngine'
import {
  carpoolProgram,
  createCarpoolGroup,
  inviteUrl,
  matchCarpool,
  rememberedAmbassador,
} from '../lib/friendRides'
import { navigate } from '../lib/navigation'

const GRAND = NEIGHBORHOODS.find((n) => n.id === 'grand-marc')
const COLLEGE = NEIGHBORHOODS.find((n) => n.id === 'college-ave')
const HOT = ['grand-marc', 'college-ave', 'memorial-stadium', 'tillman', 'tiger-town', 'the-pier', 'clemson-lofts', 'u-on-college']

const card = {
  marginTop: 16,
  padding: 16,
  borderRadius: 16,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-soft)',
}

export function CarpoolHub() {
  const { user } = useAuth()
  const [pickup, setPickup] = useState({ label: GRAND.label, lat: GRAND.lat, lng: GRAND.lng })
  const [dropoff, setDropoff] = useState({ label: COLLEGE.label, lat: COLLEGE.lat, lng: COLLEGE.lng })
  const [tailgate, setTailgate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [link, setLink] = useState(null)
  const [firstRide, setFirstRide] = useState(null)
  const now = useMemo(() => new Date(), [])
  const peakAt = useMemo(() => illustrativePeakAt(now), [now])
  const windowNow = demandWindow(now)
  const peakOn = windowNow === 'game_day' || windowNow === 'peak_night'

  const pitch = useMemo(() => {
    if (!pickup?.lat || !dropoff?.lat) return null
    return pitchQuote({ pickup, dropoff, at: peakAt, displayName: 'You' })
  }, [pickup, dropoff, peakAt])

  const nowPitch = useMemo(() => {
    if (!pickup?.lat || !dropoff?.lat) return null
    return pitchQuote({ pickup, dropoff, at: now, displayName: 'You' })
  }, [pickup, dropoff, now])

  useEffect(() => {
    if (!user) return undefined
    let alive = true
    carpoolProgram('first_ride')
      .then((data) => { if (alive) setFirstRide(data) })
      .catch(() => {})
    return () => { alive = false }
  }, [user])

  async function onMatch() {
    if (!user) { navigate('sign-in'); return }
    if (!pickup?.lat || !dropoff?.lat) { setError('Pick a start and a neighborhood.'); return }
    setBusy(true)
    setError(null)
    try {
      const data = await matchCarpool({
        pickup,
        dropoff,
        displayName: user.user_metadata?.full_name || user.email?.split('@')[0],
        partyType: tailgate ? 'tailgate' : 'carpool',
      })
      setResult(data)
      if (data.token) {
        window.location.assign(`/carpool/${encodeURIComponent(data.token)}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onShare() {
    if (!user) { navigate('sign-in'); return }
    if (!pickup?.lat || !dropoff?.lat) { setError('Pick a start and a neighborhood.'); return }
    setBusy(true)
    setError(null)
    try {
      const data = await createCarpoolGroup({
        pickup,
        dropoff,
        displayName: user.user_metadata?.full_name || user.email?.split('@')[0],
        partyType: tailgate ? 'tailgate' : 'carpool',
        driving: false,
      })
      const url = inviteUrl(data.token, 'carpool')
      setLink(url)
      try { await navigator.clipboard?.writeText(url) } catch { /* ignore */ }
      window.location.assign(data.urlPath || `/carpool/${data.token}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const hot = NEIGHBORHOODS.filter((n) => HOT.includes(n.id))

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--surface)' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 96 }}>
        <header style={{
          padding: '28px 22px 22px',
          background: 'linear-gradient(145deg, #F56600 0%, #522D80 72%)',
          color: '#fff',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4 }}>CLEMSON RIDES</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.05, margin: '8px 0 0' }}>
            Split the surge.
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.45, maxWidth: 420 }}>
            One person to Grand Marc or College Ave on a game night is about {pitch ? formatUsd(pitch.soloCents) : '$30–$40'}.
            Four Tigers in one car pay about {pitch ? formatUsd(pitch.fullShareCents) : '$10–$15'} each.
            The driver earns more than that solo trip.
          </p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ background: 'rgba(255,255,255,0.16)', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
              {peakOn ? 'Peak pricing is on right now' : 'Peak prices shown for the next Saturday night'}
            </span>
            {isGameWeek(now) && (
              <span style={{ background: 'rgba(255,255,255,0.16)', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
                Game week
              </span>
            )}
          </div>
        </header>

        <div style={{ padding: '8px 20px 24px' }}>
          <CarpoolCompare pickup={pickup} dropoff={dropoff} mode="pitch" />
          {nowPitch && !peakOn && (
            <p style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 10, lineHeight: 1.45 }}>
              Off-peak right now, this hop is {formatUsd(nowPitch.soloCents)} alone.
              The card above is the game-night price. Confirm uses the time you actually leave.
            </p>
          )}

          {isGameWeek(now) && (
            <div style={{ ...card, background: 'rgba(82,45,128,0.06)' }}>
              <div style={{ fontWeight: 800, color: 'var(--purple)' }}>First ride free during game-week peaks</div>
              <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '6px 0 0', lineHeight: 1.45 }}>
                One comp per account, only Thu–Sat nights, class change, and game day. Not a rider promo code.
                {firstRide?.eligible ? ' You are eligible on the next peak ride.' : ''}
                {firstRide?.alreadyUsed ? ' This account already used it.' : ''}
              </p>
            </div>
          )}

          <div style={card}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Where are you headed?</div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
              {hot.map((spot) => (
                <button
                  key={spot.id}
                  type="button"
                  className="pressable"
                  onClick={() => setDropoff({ label: spot.label, lat: spot.lat, lng: spot.lng })}
                  style={{
                    flex: '0 0 auto',
                    borderRadius: 999,
                    padding: '7px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    border: dropoff?.label === spot.label ? 'none' : '1px solid var(--border)',
                    background: dropoff?.label === spot.label ? '#522D80' : '#fff',
                    color: dropoff?.label === spot.label ? '#fff' : 'var(--purple)',
                  }}
                >
                  {spot.label}
                </button>
              ))}
            </div>
            <PlacePicker label="Pickup" mode="pickup" value={pickup} onChange={setPickup} />
            <PlacePicker label="Dropoff" mode="dropoff" value={dropoff} onChange={setDropoff} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, margin: '4px 0 12px' }}>
              <input type="checkbox" checked={tailgate} onChange={(e) => setTailgate(e.target.checked)} />
              Tailgate / group ride
            </label>
            <PrimaryButton onClick={onMatch} disabled={busy}>
              {busy ? 'Looking…' : 'Find my carpool'}
            </PrimaryButton>
            <button
              type="button"
              className="pressable"
              onClick={onShare}
              disabled={busy}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 10,
                padding: 14,
                borderRadius: 14,
                fontWeight: 800,
                color: 'var(--purple)',
                border: '1.5px solid rgba(82,45,128,0.35)',
                background: 'rgba(82,45,128,0.06)',
              }}
            >
              Share a link with my group
            </button>
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('carpool', { drive: '1' })}
              style={{ display: 'block', width: '100%', marginTop: 8, padding: 8, fontWeight: 700, color: 'var(--ink-secondary)' }}
            >
              I have the car — offer seats
            </button>
            {rememberedAmbassador() && (
              <p style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 8 }}>
                Ambassador {rememberedAmbassador()} will be credited if this ride completes.
              </p>
            )}
            {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
            {link && <p style={{ fontSize: 12, wordBreak: 'break-all', marginTop: 8 }}>{link}</p>}
          </div>

          {result?.pool?.waiting && (
            <div style={card}>
              <div style={{ fontWeight: 800 }}>You are in the queue</div>
              <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
                No one else is heading to {result.pool.neighborhoodLabel || 'that neighborhood'} inside the time window yet.
                Share the group link to fill the car yourself — matching still caps strangers at 4.
              </p>
            </div>
          )}
          {result?.code === 'queue_unavailable' && (
            <div style={card}>
              <div style={{ fontWeight: 800 }}>Prices are ready. The live queue is not.</div>
              <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>{result.message}</p>
            </div>
          )}

          <button
            type="button"
            className="pressable"
            onClick={() => navigate('ambassador')}
            style={{ marginTop: 18, fontWeight: 700, color: 'var(--purple)', background: 'none' }}
          >
            Campus ambassador program →
          </button>
        </div>
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
