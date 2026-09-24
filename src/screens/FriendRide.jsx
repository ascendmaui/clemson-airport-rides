import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { PlacePicker } from '../components/PlacePicker'
import { PrimaryButton } from '../components/PrimaryButton'
import { CarpoolCompare } from '../components/CarpoolCompare'
import { confirmChargeLabel, firstRideOfferCopy, firstRideWindowOpen, formatUsd, NEIGHBORHOODS, quoteCarpool, surgeDelta } from '../lib/carpoolEngine'
import {
  applyFriendChargeReview,
  friendChargeNeedsReview,
  friendQuoteRef,
  friendSplitPreview,
  markFriendQuoteReviewed,
  mergeFriendQuote,
  reviewedFriendQuoteFresh,
} from '../lib/friendSplitPreview'
import { BottomTabs } from '../components/BottomTabs'
import { SosControl } from '../components/SosControl'
import { ambassadorLobbyCopy } from '../../packages/rides-native/shared/ambassadorAttribution.js'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { formatUsdFromCents } from '../lib/pricing'
import { supabase } from '../lib/supabase'
import {
  FRIEND_PLACES, carpoolProgram, confirmFriendCharges, createFriendRide, decodePolyline,
  formatEta, formatMiles, inviteUrl, getFriendRide, joinFriendRide, recomputeFriendRide,
  vehicleMaxSeats, capacityMessage, DEFAULT_MAX_PARTICIPANTS,
} from '../lib/friendRides'
import { OFFER_CARPOOL_MAPS_NOTE, OFFER_CARPOOL_STEPS } from '../lib/placeCatalog'

const card = {
  marginTop: 16, padding: 16, borderRadius: 16, background: 'var(--surface)',
  border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)',
}

async function fetchOrganizerVehicle(userId) {
  if (!supabase || !userId) return null
  const { data } = await supabase
    .from('vehicles')
    .select('make, model, color, plate, seats, is_tesla, tier')
    .eq('driver_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

export function FriendRideScreen({ token: tokenProp, kind: kindProp = 'friends' }) {
  const { user } = useAuth()
  const isCarpool = kindProp === 'carpool'
  const productLabel = isCarpool ? 'Carpool' : 'Ride with friends'
  const [token, setToken] = useState(tokenProp || '')
  const [ride, setRide] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const reviewRef = useRef(null)
  const [busyLabel, setBusyLabel] = useState('')
  const grand = NEIGHBORHOODS.find((n) => n.id === 'grand-marc')
  const college = NEIGHBORHOODS.find((n) => n.id === 'college-ave')
  const [pickup, setPickup] = useState(isCarpool
    ? { label: grand.label, lat: grand.lat, lng: grand.lng }
    : FRIEND_PLACES[0])
  const [firstRide, setFirstRide] = useState(null)
  const [dropoff, setDropoff] = useState(isCarpool
    ? { label: college.label, lat: college.lat, lng: college.lng }
    : FRIEND_PLACES[4])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [splitMode, setSplitMode] = useState('even')
  const [tailgate, setTailgate] = useState(false)
  const [mapsHint, setMapsHint] = useState(null)
  const [vehicle, setVehicle] = useState(null)
  const [vehicleLoaded, setVehicleLoaded] = useState(false)

  useEffect(() => { if (tokenProp) setToken(tokenProp) }, [tokenProp])
  useEffect(() => {
    if (user) {
      setName(user.user_metadata?.full_name || user.email?.split('@')[0] || '')
      setEmail(user.email || '')
    }
  }, [user])

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!user?.id) {
        if (alive) { setVehicle(null); setVehicleLoaded(true) }
        return
      }
      try {
        const v = await fetchOrganizerVehicle(user.id)
        if (alive) { setVehicle(v); setVehicleLoaded(true) }
      } catch {
        if (alive) { setVehicle(null); setVehicleLoaded(true) }
      }
    })()
    return () => { alive = false }
  }, [user?.id])

  const maxParticipants = useMemo(() => {
    if (ride?.max_participants) return Number(ride.max_participants)
    if (vehicle) return vehicleMaxSeats(vehicle)
    return DEFAULT_MAX_PARTICIPANTS
  }, [ride?.max_participants, vehicle])

  const hasVehicle = Boolean(vehicle)
  const needsVehicleToCreate = true // group + carpool both require registered vehicle

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      setRide(await getFriendRide(token))
      setError(null)
    } catch (e) { setError(e.message) }
  }, [token])

  useEffect(() => {
    refresh()
    if (!token) return undefined
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [refresh, token])

  useEffect(() => {
    if (!isCarpool) return undefined
    if (!user) {
      setFirstRide(null)
      return undefined
    }
    let alive = true
    carpoolProgram('first_ride')
      .then((data) => { if (alive) setFirstRide(data) })
      .catch(() => {})
    return () => { alive = false }
  }, [isCarpool, user])

  const firstRideOffer = !isCarpool
    ? null
    : firstRideOfferCopy(user
      ? {
        windowOpen: Boolean(firstRide?.windowOpen),
        signedIn: true,
        alreadyUsed: Boolean(firstRide?.alreadyUsed),
        completedTrips: firstRide?.completedTrips || 0,
        schemaMissing: Boolean(firstRide?.schemaMissing),
      }
      : { windowOpen: firstRideWindowOpen(new Date()), signedIn: false })

  const routePath = useMemo(() => decodePolyline(ride?.route_polyline), [ride?.route_polyline])
  const carpoolQuote = useMemo(() => {
    if (!isCarpool && ride?.kind !== 'carpool') return null
    if (ride?.fare_breakdown?.carpool?.shares?.length) return ride.fare_breakdown.carpool
    const riders = (ride?.participants || [])
      .filter((p) => p.pickup?.lat != null && p.dropoff?.lat != null)
      .map((p) => ({
        id: p.id,
        displayName: p.display_name,
        pickup: p.pickup,
        dropoff: p.dropoff,
      }))
    if (!riders.length) return null
    return quoteCarpool({ riders })
  }, [isCarpool, ride])
  const selfId = (ride?.participants || []).find((p) => p.is_self)?.id || null
  const selfPart = (ride?.participants || []).find((p) => p.is_self) || (ride?.participants || [])[0]
  const hopPickup = selfPart?.pickup?.lat != null ? selfPart.pickup : pickup
  const hopDropoff = selfPart?.dropoff?.lat != null ? selfPart.dropoff : dropoff
  const delta = useMemo(
    () => (isCarpool || ride?.kind === 'carpool'
      ? surgeDelta({ pickup: hopPickup, dropoff: hopDropoff, quote: carpoolQuote, selfId })
      : null),
    [isCarpool, ride?.kind, hopPickup, hopDropoff, carpoolQuote, selfId],
  )
  const friendPreview = useMemo(
    () => (isCarpool || ride?.kind === 'carpool' ? null : friendSplitPreview(ride)),
    [isCarpool, ride],
  )
  const friendsLobby = !isCarpool && ride?.kind !== 'carpool'
  const mapCenter = ride?.stops?.[0]
    ? [ride.stops[0].lat, ride.stops[0].lng]
    : (pickup?.lat != null ? [pickup.lat, pickup.lng] : CLEMSON)

  function onPickupPinMove([lat, lng]) {
    setPickup((prev) => ({
      label: prev?.label && !String(prev.label).startsWith('Pinned')
        ? prev.label
        : `Pinned (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)})`,
      lat,
      lng,
    }))
  }

  async function onCreate() {
    if (!user) { navigate('sign-in'); return }
    if (needsVehicleToCreate && !hasVehicle) {
      setError('Add your vehicle before offering a group ride.')
      return
    }
    if (!pickup?.lat || !dropoff?.lat) {
      setError('Choose pickup and dropoff (with a map pin or place).')
      return
    }
    setBusy(true); setBusyLabel('Creating…'); setError(null)
    try {
      const data = await createFriendRide({
        displayName: name || (isCarpool ? 'Driver' : 'Organizer'),
        pickup,
        dropoff,
        splitMode,
        kind: isCarpool ? 'carpool' : 'friends',
        partyType: tailgate ? 'tailgate' : 'carpool',
        userId: user.id,
      })
      const t = data.token
      setToken(t)
      const pathKind = isCarpool ? 'carpool' : 'friends'
      window.history.replaceState({}, '', `/${pathKind}/${encodeURIComponent(t)}`)
      try {
        setBusyLabel('Calculating fares…')
        await recomputeFriendRide(t, splitMode)
      } catch (e) { setMapsHint(e.payload?.message || e.message) }
      setRide(await getFriendRide(t))
    } catch (e) { setError(e.message) }
    finally { setBusy(false); setBusyLabel('') }
  }

  async function onJoin() {
    if (!token) return
    const count = ride?.participants?.length || 0
    const alreadyIn = (ride?.participants || []).some(
      (p) => (user?.id && p.user_id === user.id) || (email && p.email && p.email.toLowerCase() === email.toLowerCase()),
    )
    const cap = ride?.max_participants || maxParticipants
    if (!alreadyIn && count >= cap) {
      setError(`This ride is full (${cap} max for this vehicle).`)
      return
    }
    setBusy(true); setBusyLabel('Saving…'); setError(null)
    try {
      await joinFriendRide({ token, displayName: name || 'Friend', email: email || undefined, pickup, dropoff, userId: user?.id })
      try {
        setBusyLabel('Calculating fares…')
        await recomputeFriendRide(token, splitMode)
        setMapsHint(null)
      } catch (e) { setMapsHint(e.payload?.message || e.message) }
      await refresh()
    } catch (e) { setError(e.message) }
    finally { setBusy(false); setBusyLabel('') }
  }

  async function onRecompute() {
    setBusy(true); setBusyLabel('Calculating fares…'); setError(null)
    try {
      setRide(mergeFriendQuote(ride, await recomputeFriendRide(token, splitMode)))
      setMapsHint(null)
    } catch (e) {
      setMapsHint(e.payload?.message || e.message)
      setError(e.message)
    } finally { setBusy(false); setBusyLabel('') }
  }

  async function onConfirmCharges() {
    setBusy(true); setError(null)
    const shown = ride
    const reviewed = friendsLobby && reviewedFriendQuoteFresh(reviewRef.current, shown)
    reviewRef.current = null
    try {
      setBusyLabel('Calculating fares…')
      let priced = shown
      let refreshed = false
      if (!reviewed) {
        try {
          const next = await recomputeFriendRide(token, splitMode)
          priced = friendsLobby ? mergeFriendQuote(shown, next) : next
          setRide(priced)
          refreshed = true
          setMapsHint(null)
        } catch (e) {
          // If recompute fails (e.g. maps key), still try charge if fares already present
          setMapsHint(e.payload?.message || e.message)
          if (!shown?.total_fare_cents) {
            setError(e.payload?.message || e.message || 'Could not update fares. Try Optimize route & fares first.')
            return
          }
        }
      }
      if (friendsLobby && refreshed && friendChargeNeedsReview(shown, priced)) {
        reviewRef.current = markFriendQuoteReviewed(priced)
        setMapsHint('Review each share, then confirm to charge.')
        return
      }
      setBusyLabel('Charging…')
      const quoteRef = friendsLobby ? friendQuoteRef(priced) : null
      const data = await confirmFriendCharges(token, {
        quoteId: quoteRef?.quoteId,
        quoteSignature: quoteRef?.quoteSignature,
      })
      if (friendsLobby && data?.status === 'review_required') {
        const next = applyFriendChargeReview(priced, data)
        setRide(next)
        reviewRef.current = markFriendQuoteReviewed(next)
        setMapsHint('Review each share, then confirm to charge.')
        return
      }
      setRide(data.ride)
      if (data.booked) {
        const assigned = data.trip?.driver_id || ride?.driver_profile_id
        setMapsHint(
          assigned
            ? `Booked trip ${data.trip?.id} - driver assigned (carpool organizer).`
            : `Booked trip ${data.trip?.id} - searching for a driver.`,
        )
      } else if (data.paymentElementSecrets?.length) {
        setMapsHint('Some riders need to finish payment (saved card missing or requires authentication).')
      }
    } catch (e) { setError(e.message) }
    finally { setBusy(false); setBusyLabel('') }
  }

  async function onCopy() {
    const url = inviteUrl(token, isCarpool ? 'carpool' : 'friends')
    try {
      await navigator.clipboard?.writeText(url)
      await navigator.share?.({ title: productLabel, url }).catch(() => {})
    } catch {}
  }

  if (!token) {
    const vehicleBlock = needsVehicleToCreate && vehicleLoaded && !hasVehicle
    return (
      <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <div style={{ flex: 1, padding: 24, paddingBottom: 96 }}>
          <button type="button" className="pressable" onClick={() => navigate('friends')}
            style={{ fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14, background: 'var(--surface)', boxShadow: 'var(--shadow-pill)' }}>←</button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>
            {isCarpool ? 'Offer a carpool' : 'Ride with friends'}
          </h1>

          {isCarpool ? (
            <div style={{ ...card, marginTop: 12, background: 'linear-gradient(160deg, rgba(82,45,128,0.06), rgba(245,102,0,0.08))' }}>
              <div style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 8 }}>How carpool works</div>
              <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-secondary)', fontSize: 13, lineHeight: 1.55 }}>
                {OFFER_CARPOOL_STEPS.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 10, lineHeight: 1.45 }}>
                For Clemson student drivers with a registered car. Capacity comes from your vehicle
                {hasVehicle
                  ? ` (${vehicle.make || ''} ${vehicle.model || ''} · up to ${maxParticipants} total)`.replace(/\s+/g, ' ').trim()
                  : ''}. {OFFER_CARPOOL_MAPS_NOTE}
              </p>
            </div>
          ) : (
            <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45 }}>
              Invite friends, pick campus or airport stops, and split the fare evenly or by each rider's hop.
              Party size is capped by your registered vehicle
              {hasVehicle ? ` (max ${maxParticipants} total)` : ''}.
              {' '}Stops save without a Maps key. Optimizing friend-ride miles still needs the server Routes key.
            </p>
          )}

          {vehicleBlock && (
            <div style={{ ...card, borderColor: 'rgba(245,102,0,0.45)' }}>
              <div style={{ fontWeight: 700, color: 'var(--orange)', marginBottom: 6 }}>Vehicle required</div>
              <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
                Add your vehicle before offering a group ride. We use your registered seats to cap the party.
              </p>
              <button
                type="button"
                className="pressable"
                onClick={() => navigate('driver-signup')}
                style={{ marginTop: 10, fontWeight: 700, color: 'var(--purple)' }}
              >
                Add your vehicle →
              </button>
            </div>
          )}

          <div style={card}>
            <label style={{ display: 'block', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Your name</div>
              <input value={name} onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)' }} />
            </label>
            <PlacePicker
              label={isCarpool ? 'Your start' : 'Your pickup'}
              mode="pickup"
              value={pickup}
              onChange={setPickup}
              presets={FRIEND_PLACES}
            />
            <PlacePicker
              label={isCarpool ? 'Your end' : 'Your dropoff'}
              mode="dropoff"
              value={dropoff}
              onChange={setDropoff}
              presets={FRIEND_PLACES}
            />
            {pickup?.lat != null && (
              <div style={{ marginBottom: 12, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginBottom: 6 }}>
                  Drag the map to fine-tune pickup
                </div>
                <CampusMap
                  height={160}
                  interactive
                  dragPin
                  center={[pickup.lat, pickup.lng]}
                  marker={[pickup.lat, pickup.lng]}
                  onPinMove={onPickupPinMove}
                  zoom={15}
                />
              </div>
            )}
            {isCarpool && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                <input type="checkbox" checked={tailgate} onChange={(e) => setTailgate(e.target.checked)} />
                Tailgate party (up to 6 if your vehicle fits)
              </label>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ marginRight: 16 }}>
                <input type="radio" checked={splitMode === 'even'} onChange={() => setSplitMode('even')} /> Even
              </label>
              <label>
                <input type="radio" checked={splitMode === 'by_distance'} onChange={() => setSplitMode('by_distance')} /> By distance
              </label>
            </div>
            {hasVehicle && (
              <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 10 }}>
                {capacityMessage(maxParticipants, { hasVehicle: true })}
              </p>
            )}
            {isCarpool && <CarpoolCompare pickup={pickup} dropoff={dropoff} mode="pitch" />}
            <PrimaryButton onClick={onCreate} disabled={busy || vehicleBlock}>
              {busy ? (busyLabel || 'Creating…') : isCarpool ? 'Offer a carpool' : 'Create invite link'}
            </PrimaryButton>
            {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
          </div>
        </div>
        <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
      </div>
    )
  }

  const isOrganizer = ride?.is_organizer
  const cap = ride?.max_participants || maxParticipants

  const sosViewer = isCarpool && isOrganizer ? 'driver' : 'rider'
  const ambassadorNotice = (isCarpool || ride?.kind === 'carpool')
    ? ambassadorLobbyCopy(ride?.fare_breakdown?.ambassador_code)
    : null

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {ride?.trip_id && (
        <SosControl tripId={ride.trip_id} viewerRole={sosViewer} />
      )}
      <div style={{ flex: 1, padding: 24, paddingBottom: 96, overflow: 'auto' }}>
        <button type="button" className="pressable" onClick={() => navigate('friends')}
          style={{ fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14, background: 'var(--surface)', boxShadow: 'var(--shadow-pill)' }}>←</button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>
          {isCarpool
            ? (isOrganizer ? 'Carpool lobby' : 'Join carpool')
            : (isOrganizer ? 'Friend ride lobby' : 'Join friend ride')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginTop: 4 }}>Status: {ride?.status || '…'}</p>
        {ambassadorNotice && (
          <div style={card}>
            <div style={{ fontWeight: 800 }}>{ambassadorNotice.title}</div>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '6px 0 0' }}>
              {ambassadorNotice.body}
            </p>
          </div>
        )}
        {isCarpool && !(user && !firstRide) && firstRideOffer && (
          <div style={{ ...card, background: 'rgba(82,45,128,0.06)' }}>
            <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{firstRideOffer.title}</div>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '6px 0 0', lineHeight: 1.45 }}>{firstRideOffer.body}</p>
          </div>
        )}

        <div style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden' }}>
          <CampusMap height={200} interactive center={mapCenter} zoom={routePath ? 11 : 14} route={routePath} marker={mapCenter} />
        </div>

        {(ride?.distance_m || ride?.total_fare_cents) && (
          <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>Distance</div><div style={{ fontWeight: 700 }}>{formatMiles(ride.distance_m)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>ETA</div><div style={{ fontWeight: 700 }}>{formatEta(ride.duration_s)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>Total</div><div style={{ fontWeight: 700 }}>{formatUsdFromCents(ride.total_fare_cents)}</div></div>
          </div>
        )}

        {mapsHint && <p style={{ fontSize: 12, color: 'var(--orange)', marginTop: 10 }}>{mapsHint}</p>}

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Invite link</div>
          <p style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--ink-secondary)' }}>{inviteUrl(token, isCarpool || ride?.kind === 'carpool' ? 'carpool' : 'friends')}</p>
          <button type="button" className="pressable" onClick={onCopy} style={{ marginTop: 8, fontWeight: 600, color: 'var(--purple)' }}>Copy / share →</button>
        </div>

        {friendsLobby && friendPreview?.rows?.length > 0 && (
          <div style={card} aria-label="Fare split preview">
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: '#F56600' }}>BEFORE YOU CONFIRM</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>Fare split preview</div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '6px 0 10px', lineHeight: 1.45 }}>
              Server quote · {friendPreview.splitMode === 'by_distance' ? 'by distance' : 'even'}.
              Struck prices are this route alone. Confirm charges these shares with a saved card off-session, or Apple Pay / Payment Element.
            </div>
            {friendPreview.headline && (
              <>
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-tertiary)' }}>This route alone</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-secondary)', textDecoration: 'line-through' }}>{formatUsd(friendPreview.headline.soloCents)}</div>
                  </div>
                  <div style={{ alignSelf: 'center', fontSize: 22, fontWeight: 800, color: '#F56600' }} aria-hidden="true">→</div>
                  <div style={{ flex: 1, background: '#fff', borderRadius: 14, padding: 12, border: '1.5px solid #F56600' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#F56600' }}>Your share</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: '#F56600' }}>{formatUsd(friendPreview.headline.shareCents)}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: '#F56600', color: '#fff', fontWeight: 800, fontSize: 16 }}>
                  You save {formatUsd(friendPreview.headline.savingsCents)}
                </div>
              </>
            )}
            {friendPreview.rows.map((row) => (
              <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{row.name}</div>
                  {!friendPreview.headline && row.soloCents != null && (
                    <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', textDecoration: 'line-through' }}>
                      This route alone {formatUsd(row.soloCents)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: '#F56600' }}>{formatUsd(row.shareCents)}</div>
                  {!friendPreview.headline && row.savingsCents > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#F56600' }}>Save {formatUsd(row.savingsCents)}</div>
                  )}
                </div>
              </div>
            ))}
            {friendPreview.totalCents != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontWeight: 700 }}>
                <span>Total</span><span>{formatUsd(friendPreview.totalCents)}</span>
              </div>
            )}
          </div>
        )}

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            Participants ({ride?.participants?.length || 0}/{cap})
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 8 }}>
            Max {cap} for this vehicle{ride?.vehicle_label ? ` · ${ride.vehicle_label}` : ''}.
          </div>
          {(ride?.participants || []).map((p) => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{p.display_name}</strong>
                <span style={{ color: 'var(--ink-tertiary)' }}>· {p.status}</span>
                {(carpoolQuote?.shares || []).some((share) => share.id === p.id && share.firstRideFree) && (
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, color: '#F56600' }}>First ride free</span>
                )}
                {p.student_verified_at && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: '2px 8px', borderRadius: 999,
                    background: 'rgba(82,45,128,0.12)', color: 'var(--purple)',
                  }}>Clemson student</span>
                )}
                {p.rating_avg != null && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                    ★ {Number(p.rating_avg).toFixed(1)}
                    {p.rating_count ? ` (${p.rating_count})` : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>
                {p.pickup?.label || '-'} → {p.dropoff?.label || '-'}
              </div>
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{isOrganizer ? 'Update stops' : 'Add your stops'}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 10 }} />
          {!user && (
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 10 }} />
          )}
          <PlacePicker label="Pickup" mode="pickup" value={pickup} onChange={setPickup} presets={FRIEND_PLACES} />
          <PlacePicker label="Dropoff" mode="dropoff" value={dropoff} onChange={setDropoff} presets={FRIEND_PLACES} />
          {pickup?.lat != null && (
            <div style={{ marginBottom: 12, borderRadius: 16, overflow: 'hidden' }}>
              <CampusMap
                height={140}
                interactive
                dragPin
                center={[pickup.lat, pickup.lng]}
                marker={[pickup.lat, pickup.lng]}
                onPinMove={onPickupPinMove}
                zoom={15}
              />
            </div>
          )}
          {(isCarpool || ride?.kind === 'carpool') && !isOrganizer && (
            <CarpoolCompare
              pickup={hopPickup}
              dropoff={hopDropoff}
              quote={carpoolQuote}
              selfId={selfId}
              mode="confirm"
            />
          )}
          <PrimaryButton onClick={onJoin} disabled={busy}>{busy ? (busyLabel || 'Saving…') : 'Save stops'}</PrimaryButton>
        </div>

        {isOrganizer && (
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Organizer</div>
            <label style={{ marginRight: 16 }}>
              <input type="radio" checked={splitMode === 'even'} onChange={() => setSplitMode('even')} /> Even
            </label>
            <label>
              <input type="radio" checked={splitMode === 'by_distance'} onChange={() => setSplitMode('by_distance')} /> By distance
            </label>
            <div style={{ height: 10 }} />
            <PrimaryButton onClick={onRecompute} disabled={busy}>
              {busy && busyLabel === 'Calculating fares…' ? 'Calculating fares…' : 'Optimize route & fares'}
            </PrimaryButton>
            <div style={{ height: 10 }} />
            {isCarpool && (
              <CarpoolCompare
                pickup={hopPickup}
                dropoff={hopDropoff}
                quote={carpoolQuote}
                selfId={selfId}
                mode="confirm"
              />
            )}
            <PrimaryButton onClick={onConfirmCharges} disabled={busy || ride?.status === 'booked' || (isCarpool && !carpoolQuote)}>
              {friendsLobby && ride?.status !== 'booked' && !(busy && (busyLabel === 'Calculating fares…' || busyLabel === 'Charging…'))
                ? (friendPreview?.eachCents != null
                  ? `Confirm · charge ${formatUsd(friendPreview.eachCents)} each`
                  : friendPreview?.rows?.length
                    ? 'Confirm & charge friends'
                    : 'Price the split')
                : confirmChargeLabel({
                  booked: ride?.status === 'booked',
                  busyLabel: busy && (busyLabel === 'Calculating fares…' || busyLabel === 'Charging…') ? busyLabel : '',
                  isCarpool,
                  shareCents: delta?.currentShareCents,
                  firstRideFree: Boolean(delta?.currentFirstRideFree),
                })}
            </PrimaryButton>
            <p style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 8 }}>
              Confirm updates fares from the live route, then charges full shares · saved card or Apple Pay / Payment Element.
              Books when all Paid{isCarpool ? ' · you are the assigned driver' : ''}.
            </p>
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        {ride?.trip_id && (
          <div style={card}>
            <div style={{ fontWeight: 700 }}>
              {isCarpool || ride?.kind === 'carpool' || ride?.driver_profile_id
                ? 'Driver assigned'
                : 'Driver searching'}
            </div>
            <button type="button" className="pressable" onClick={() => navigate('requested', { trip: ride.trip_id })}
              style={{ marginTop: 8, fontWeight: 600, color: 'var(--purple)' }}>Open trip →</button>
          </div>
        )}
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
