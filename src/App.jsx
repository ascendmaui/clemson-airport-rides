import { useEffect, useState } from 'react'
import { bindKeyboardInset, scrollFocusedFieldIntoView } from './lib/keyboardInset'
import { getHashRoute, redirectShareHashToPath } from './lib/navigation'
import { capturePromoFromLocation } from './lib/riderPromo'
import {
  hasClemsonMiamiLink,
  openClemsonMiamiCheckout,
  rememberClemsonMiamiFromLocation,
} from './lib/clemsonMiamiRide'
import { useAuth } from './lib/auth'
import {
  claimAmbassadorAttribution,
  clearAmbassadorAttribution,
  rememberAmbassador,
  rememberedAmbassador,
} from './lib/friendRides'
import { RequireAuth } from './components/RequireAuth'
import { Marketing } from './screens/Marketing'
import { RiderHome } from './screens/RiderHome'
import { ConfirmPickup } from './screens/ConfirmPickup'
import { RideTiers } from './screens/RideTiers'
import { ScheduleAirport } from './screens/ScheduleAirport'
import { DriverHome } from './screens/DriverHome'
import { DriverEarnings } from './screens/DriverEarnings'
import { FriendsScreen, AccountScreen } from './screens/FriendsAccount'
import { SignInScreen, SignUpScreen } from './screens/AuthScreens'
import { DriverOnboarding } from './screens/DriverOnboarding'
import { SignAgreement } from './screens/SignAgreement'
import { DriverSignup } from './screens/DriverSignup'
import { AdminDesk } from './screens/AdminDesk'
import { PickDriver } from './screens/PickDriver'
import { Requested } from './screens/Requested'
import { LegalPrivacy, LegalTerms } from './screens/LegalPages'
import { ServiceArea } from './screens/ServiceArea'
import { LiveShare } from './screens/LiveShare'
import { ProfileView } from './screens/ProfileView'
import { RateRide } from './screens/RateRide'
import { TipRide } from './screens/TipRide'
import { ReceiptScreen } from './screens/ReceiptScreen'
import { FriendRideScreen } from './screens/FriendRide'
import { CarpoolScreen } from './screens/CarpoolScreen'
import { CarpoolHub } from './screens/CarpoolHub'
import { AmbassadorScreen } from './screens/AmbassadorScreen'
import { ToastProvider, ToastStack } from './lib/toasts'
import { RideToastWatcher } from './components/RideToastWatcher'
import { RiderMatchPopup } from './components/RiderMatchPopup'
import { WeeklyCouponNotice } from './components/WeeklyCouponNotice'
import { DriverOfferWatcher } from './components/DriverOfferWatcher'
import { DriverBillingEntry } from './components/DriverBillingEntry'
import { IncentivesAdmin } from './screens/IncentivesAdmin'
import { LostFoundWatcher } from './components/LostFoundWatcher'
import { TripMessageBanner } from './components/TripMessageBanner'
import { RiderPickupStream } from './components/RiderPickupStream'
import { LostFound } from './screens/LostFound'
import { RidesHistory } from './screens/RidesHistory'

function AmbassadorAttributionSync() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user?.id) return undefined
    const code = rememberedAmbassador(user.id)
    if (!code) return undefined
    let alive = true
    claimAmbassadorAttribution(code)
      .then((data) => {
        if (alive && data?.code) rememberAmbassador(data.code, user.id)
      })
      .catch((err) => {
        if (!alive) return
        if (err?.status === 404 || err?.status === 409 || err?.payload?.code === 'own_link') {
          clearAmbassadorAttribution()
        }
      })
    return () => { alive = false }
  }, [user?.id])
  return null
}

const PROTECTED = new Set(['driver', 'driver-onboarding', 'account', 'driver-signup', 'admin', 'admin-dashboard', 'incentives', 'lost-found', 'history', 'earnings', 'sign-agreement'])
const SITE_ROUTES = new Set(['landing', '', 'privacy', 'terms', 'service-area'])

function Screen({ path, params }) {
  switch (path) {
    case 'landing':
    case '':
      return <Marketing />
    case 'sign-in':
      return <SignInScreen />
    case 'sign-up':
      return <SignUpScreen />
    case 'privacy':
      return <LegalPrivacy />
    case 'terms':
      return <LegalTerms />
    case 'service-area':
      return <ServiceArea />
    case 'share':
    case 'live':
      return <LiveShare token={params.token || ''} />
    case 'profile':
      return <ProfileView />
    case 'rate':
      return <RateRide />
    case 'tip':
      return <TipRide />
    case 'receipt':
      return <ReceiptScreen />
    case 'home':
    case 'rides':
      return <RiderHome />
    case 'confirm':
      return (
        <ConfirmPickup
          dest={params.dest || 'GSP Airport'}
          pickup={params.pickup || ''}
          pickupLat={params.pickupLat || ''}
          pickupLng={params.pickupLng || ''}
        />
      )
    case 'tiers':
      return (
        <RideTiers
          dest={params.dest || '1900 GSP Dr'}
          pickup={params.pickup || ''}
          pickupLat={params.pickupLat || ''}
          pickupLng={params.pickupLng || ''}
          destLat={params.destLat || ''}
          destLng={params.destLng || ''}
          billing={params.billing || ''}
        />
      )
    case 'pick-driver':
      return (
        <PickDriver
          dest={params.dest || 'GSP Airport'}
          tier={params.tier || 'standard'}
          listCents={params.listCents || ''}
          pickup={params.pickup || ''}
          pickupLat={params.pickupLat || ''}
          pickupLng={params.pickupLng || ''}
          destLat={params.destLat || ''}
          destLng={params.destLng || ''}
          billing={params.billing || ''}
        />
      )
    case 'requested':
      return <Requested dest={params.dest} trip={params.trip} driver={params.driver} paid={params.paid || ''} payfail={params.payfail || ''} sessionId={params.session_id || params.sessionId || ''} />
    case 'schedule':
      return <ScheduleAirport />
    case 'driver':
      return (
        <RequireAuth>
          <DriverHome openChatTripId={params.chat || ''} />
        </RequireAuth>
      )
    case 'earnings':
      return (
        <RequireAuth>
          <DriverEarnings />
        </RequireAuth>
      )
    case 'driver-onboarding':
      return (
        <RequireAuth>
          <DriverOnboarding />
        </RequireAuth>
      )
    case 'driver-signup':
      return (
        <RequireAuth>
          <DriverSignup />
        </RequireAuth>
      )
    case 'sign-agreement':
      return (
        <RequireAuth>
          <SignAgreement token={params.token || ''} />
        </RequireAuth>
      )
    case 'admin':
      return (
        <RequireAuth>
          <AdminDesk />
        </RequireAuth>
      )
    case 'admin-dashboard':
      return (
        <RequireAuth>
          <AdminDesk />
        </RequireAuth>
      )
    case 'friends':
      if (params.token) {
        return (
          <FriendRideScreen
            token={params.token}
            kind={params.kind === 'carpool' ? 'carpool' : 'friends'}
          />
        )
      }
      return (
        <RequireAuth>
          <FriendsScreen />
        </RequireAuth>
      )
    case 'friend-ride':
      return <FriendRideScreen token={params.token || ''} kind="friends" />
    case 'carpool':
      if (params.drive === '1') return <CarpoolScreen token="" />
      if (params.token && params.hub !== '1') return <CarpoolScreen token={params.token} />
      return <CarpoolHub />
    case 'ambassador':
    case 'a':
      return <AmbassadorScreen code={params.code || ''} />
    case 'account':
      return (
        <RequireAuth>
          <AccountScreen />
        </RequireAuth>
      )
    case 'incentives':
      return (
        <RequireAuth>
          <IncentivesAdmin />
        </RequireAuth>
      )
    case 'lost-found':
      return <LostFound />
    case 'history':
      return <RidesHistory />
    default:
      return <Marketing />
  }
}

export default function App() {
  const [{ path, params }, setRoute] = useState(() => getHashRoute())
  const { user, loading } = useAuth()

  useEffect(() => {
    if (redirectShareHashToPath()) return undefined
    const onRoute = () => {
      capturePromoFromLocation()
      rememberClemsonMiamiFromLocation()
      if (redirectShareHashToPath()) return
      setRoute(getHashRoute())
    }
    window.addEventListener('hashchange', onRoute)
    window.addEventListener('popstate', onRoute)
    const t = window.setTimeout(onRoute, 0)
    return () => {
      window.removeEventListener('hashchange', onRoute)
      window.removeEventListener('popstate', onRoute)
      window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const stopInset = bindKeyboardInset()
    document.addEventListener('focusin', scrollFocusedFieldIntoView)
    return () => {
      stopInset()
      document.removeEventListener('focusin', scrollFocusedFieldIntoView)
    }
  }, [])

  useEffect(() => {
    rememberClemsonMiamiFromLocation()
    if (loading || !user || !hasClemsonMiamiLink()) return undefined
    let alive = true
    openClemsonMiamiCheckout().catch((err) => {
      if (alive) console.error('[clemson-miami]', err?.message || err)
    })
    return () => {
      alive = false
    }
  }, [user, loading, path])

  const overflow = path === 'driver' ? 'hidden' : 'auto'
  const site = SITE_ROUTES.has(path)

  return (
    <ToastProvider>
      <div className={site ? 'desktop-frame desktop-frame--site' : 'desktop-frame'}>
        <div className={site ? 'app-shell app-shell--site' : 'app-shell'} style={{ position: 'relative', height: '100%' }}>
          <AmbassadorAttributionSync />
          <RideToastWatcher />
          <RiderMatchPopup />
          <WeeklyCouponNotice />
          <DriverOfferWatcher />
          <LostFoundWatcher />
          <TripMessageBanner />
          <RiderPickupStream />
          <ToastStack />
          <div
            key={`${path}:${params.token || params.id || params.trip || ''}`}
            className={site ? 'route-fade route-site' : 'route-fade'}
            style={site ? undefined : { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow }}
            data-protected={PROTECTED.has(path) ? '1' : '0'}
            data-guest-browse={PROTECTED.has(path) ? '0' : '1'}
            data-route={path}
          >
            <Screen path={path} params={params} />
          </div>
          {path === 'driver' && <DriverBillingEntry />}
        </div>
      </div>
    </ToastProvider>
  )
}
