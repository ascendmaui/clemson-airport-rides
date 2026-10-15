import { Suspense, lazy, useEffect, useState } from 'react'
import { useGlassMotion } from './lib/glassMotion'
import { bindKeyboardInset, scrollFocusedFieldIntoView } from './lib/keyboardInset'
import { getHashRoute, navigate, redirectShareHashToPath } from './lib/navigation'
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
import { AccessibleAlert, AccessibleErrorBoundary } from './components/AccessibleAlert'
import { AppDownloadPage } from './screens/AppDownload'
import { Marketing } from './screens/Marketing'
import { WhyClemsonRides } from './screens/WhyClemsonRides'
import { DriveWithUs } from './screens/DriveWithUs'
import { PartnerJoin, PartnerDashboard, DriverRentals } from './screens/RentalPartners'
import {
  FaqPage,
  GetTheAppPage,
  HowItWorks,
  PromosPage,
  RideTypesPage,
  SafetyPage,
  SupportPage,
  TigerPassPage,
} from './screens/MarketingInfo'
import { RiderHome } from './screens/RiderHome'
import { ConfirmPickup } from './screens/ConfirmPickup'
import { RideTiers } from './screens/RideTiers'
import { ScheduleAirport } from './screens/ScheduleAirport'
import { FriendsScreen, AccountScreen } from './screens/FriendsAccount'
import { SignInScreen, SignUpScreen } from './screens/AuthScreens'
import { DriverSignup } from './screens/DriverSignup'
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
import { PartyNightScreen } from './screens/PartyNight'
import { AmbassadorScreen } from './screens/AmbassadorScreen'
import { AffiliatesScreen, AffiliateLanding } from './screens/Affiliates'
import { AffiliateAttributionSync } from './components/AffiliateAttributionSync'
import { ToastProvider, ToastStack } from './lib/toasts'
import { RideToastWatcher } from './components/RideToastWatcher'
import { RiderMatchPopup } from './components/RiderMatchPopup'
import { WeeklyCouponNotice } from './components/WeeklyCouponNotice'
import { DriverOfferWatcher } from './components/DriverOfferWatcher'
import { DriverBillingEntry } from './components/DriverBillingEntry'
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

const PROTECTED = new Set(['drivers', 'rentals', 'driver', 'driver-onboarding', 'account', 'driver-signup', 'admin', 'admin-dashboard', 'incentives', 'lost-found', 'history', 'earnings', 'sign-agreement'])
/** Driver desk and admin screens load on demand so riders and visitors skip that code. */
const DriverHome = lazy(() => import('./screens/DriverHome').then((m) => ({ default: m.DriverHome })))
const DriverEarnings = lazy(() => import('./screens/DriverEarnings').then((m) => ({ default: m.DriverEarnings })))
const DriverW9 = lazy(() => import('./screens/DriverW9').then((m) => ({ default: m.DriverW9 })))
const DriverPayouts = lazy(() => import('./screens/DriverPayouts').then((m) => ({ default: m.DriverPayouts })))
const DriverOnboarding = lazy(() => import('./screens/DriverOnboarding').then((m) => ({ default: m.DriverOnboarding })))
const SignAgreement = lazy(() => import('./screens/SignAgreement').then((m) => ({ default: m.SignAgreement })))
const AdminDesk = lazy(() => import('./screens/AdminDesk').then((m) => ({ default: m.AdminDesk })))
const AffiliateAdmin = lazy(() => import('./screens/AffiliateAdmin').then((m) => ({ default: m.AffiliateAdmin })))
const IncentivesAdmin = lazy(() => import('./screens/IncentivesAdmin').then((m) => ({ default: m.IncentivesAdmin })))

/** Booking screens that switch to a map-plus-card layout on wide screens. */
const WIDE_BOOKING_ROUTES = new Set(['home', 'confirm'])

const SITE_ROUTES = new Set([
  'landing',
  '',
  'privacy',
  'terms',
  'service-area',
  'why-clemson-rides',
  'drive',
  'how-it-works',
  'ride-types',
  'tiger-pass',
  'safety',
  'promos',
  'faq',
  'support',
  'get-the-app',
  'download',
  'driver-download',
  'affiliate',
  'affiliates',
])

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
    case 'why-clemson-rides':
      return <WhyClemsonRides />
    case 'drive':
      return <DriveWithUs />
    case 'how-it-works':
      return <HowItWorks />
    case 'ride-types':
      return <RideTypesPage />
    case 'tiger-pass':
      return <TigerPassPage />
    case 'safety':
      return <SafetyPage />
    case 'promos':
      return <PromosPage />
    case 'faq':
      return <FaqPage />
    case 'support':
      return <SupportPage />
    case 'get-the-app':
      return <GetTheAppPage />
    case 'download':
      return <AppDownloadPage appId="rider" />
    case 'driver-download':
      return <AppDownloadPage appId="driver" />
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
          tier={params.tier || ''}
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
          tier={params.tier || ''}
          passengers={params.passengers || ''}
        />
      )
    case 'pick-driver':
      return (
        <PickDriver
          dest={params.dest || 'GSP Airport'}
          tier={params.tier || 'standard'}
          passengers={params.passengers || ''}
          listCents={params.listCents || ''}
          pickup={params.pickup || ''}
          pickupLat={params.pickupLat || ''}
          pickupLng={params.pickupLng || ''}
          destLat={params.destLat || ''}
          destLng={params.destLng || ''}
          billing={params.billing || ''}
          driver={params.driver || ''}
          tip={params.tip || ''}
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
    case 'driver-w9':
      return (
        <RequireAuth>
          <DriverW9 />
        </RequireAuth>
      )
    case 'driver-payouts':
      return (
        <RequireAuth>
          <DriverPayouts />
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
          <DriverSignup needsVehicle={params.needs_vehicle === '1'} />
        </RequireAuth>
      )
    case 'sign-agreement':
      return (
        <RequireAuth>
          <SignAgreement token={params.token || ''} />
        </RequireAuth>
      )
    case 'partners':
      if (params.sub === 'join') return <PartnerJoin />
      return (
        <RequireAuth>
          <PartnerDashboard />
        </RequireAuth>
      )
    case 'drivers':
    case 'rentals':
      return (
        <RequireAuth>
          <DriverRentals />
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
    case 'party-night':
      return <PartyNightScreen token={params.token || ''} />
    case 'ambassador':
    case 'a':
      return <AmbassadorScreen code={params.code || ''} />
    case 'affiliate':
    case 'affiliates':
      return <AffiliatesScreen />
    case 'r':
      return <AffiliateLanding />
    case 'affiliate-admin':
      return (
        <RequireAuth>
          <AffiliateAdmin />
        </RequireAuth>
      )
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

function RouteErrorFallback({ path, params, reset }) {
  const requested = path === 'requested'
  return (
    <div className="accessible-error-boundary">
      <AccessibleAlert
        title={requested ? 'Unable to display your trip' : 'Unable to display this page'}
        message={requested
          ? 'Your ride request may already be placed. Check your trip status before requesting another ride.'
          : 'Something went wrong while loading this page. Please try again.'}
        onRetry={reset}
        onDismiss={() => navigate('home')}
        dismissLabel="Back home"
      >
        {requested && params.trip && (
          <a className="pressable" href={`#/requested?trip=${encodeURIComponent(params.trip)}`} onClick={reset}>
            Reopen your trip
          </a>
        )}
      </AccessibleAlert>
    </div>
  )
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
  const routeKey = `${path}:${params.token || params.id || params.trip || params.sub || ''}`
  useGlassMotion(routeKey)

  return (
    <ToastProvider>
      <div className={site ? 'desktop-frame desktop-frame--site' : 'desktop-frame'}>
        <div className={site ? 'app-shell app-shell--site' : WIDE_BOOKING_ROUTES.has(path) ? 'app-shell app-shell--wide' : 'app-shell'} style={{ position: 'relative', height: '100%' }}>
          <AccessibleErrorBoundary fallback={() => null}><AmbassadorAttributionSync /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><AffiliateAttributionSync path={path} /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><RideToastWatcher /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><RiderMatchPopup /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><WeeklyCouponNotice /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><DriverOfferWatcher /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><LostFoundWatcher /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><TripMessageBanner /></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><RiderPickupStream /></AccessibleErrorBoundary>
          <ToastStack />
          <div
            key={routeKey}
            className={site ? 'route-fade route-site' : 'route-fade'}
            style={site ? undefined : { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow }}
            data-protected={PROTECTED.has(path) ? '1' : '0'}
            data-guest-browse={PROTECTED.has(path) ? '0' : '1'}
            data-route={path}
          >
            <AccessibleErrorBoundary
              key={routeKey}
              fallback={({ reset }) => <RouteErrorFallback path={path} params={params} reset={reset} />}
            >
              <Suspense fallback={<div className="route-loading" role="status" aria-live="polite" style={{ padding: 24, color: 'var(--ink-secondary)' }}>Loading…</div>}>
                <Screen path={path} params={params} />
              </Suspense>
            </AccessibleErrorBoundary>
          </div>
          {path === 'driver' && <AccessibleErrorBoundary fallback={() => null}><DriverBillingEntry /></AccessibleErrorBoundary>}
        </div>
      </div>
    </ToastProvider>
  )
}
