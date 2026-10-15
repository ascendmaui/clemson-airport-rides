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
import { Marketing } from './screens/Marketing'
import { AffiliateAttributionSync } from './components/AffiliateAttributionSync'
import { ToastProvider, ToastStack } from './lib/toasts'

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
/** Signed-in watchers load right after first paint; they render nothing until a trip or offer exists. */
const RideToastWatcher = lazy(() => import('./components/RideToastWatcher').then((m) => ({ default: m.RideToastWatcher })))
const RiderMatchPopup = lazy(() => import('./components/RiderMatchPopup').then((m) => ({ default: m.RiderMatchPopup })))
const WeeklyCouponNotice = lazy(() => import('./components/WeeklyCouponNotice').then((m) => ({ default: m.WeeklyCouponNotice })))
const DriverOfferWatcher = lazy(() => import('./components/DriverOfferWatcher').then((m) => ({ default: m.DriverOfferWatcher })))
const LostFoundWatcher = lazy(() => import('./components/LostFoundWatcher').then((m) => ({ default: m.LostFoundWatcher })))
const TripMessageBanner = lazy(() => import('./components/TripMessageBanner').then((m) => ({ default: m.TripMessageBanner })))
const RiderPickupStream = lazy(() => import('./components/RiderPickupStream').then((m) => ({ default: m.RiderPickupStream })))
const DriverBillingEntry = lazy(() => import('./components/DriverBillingEntry').then((m) => ({ default: m.DriverBillingEntry })))
/** Marketing pages other than home load on demand too. */
const AppDownloadPage = lazy(() => import('./screens/AppDownload').then((m) => ({ default: m.AppDownloadPage })))
const WhyClemsonRides = lazy(() => import('./screens/WhyClemsonRides').then((m) => ({ default: m.WhyClemsonRides })))
const DriveWithUs = lazy(() => import('./screens/DriveWithUs').then((m) => ({ default: m.DriveWithUs })))
const FaqPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.FaqPage })))
const GetTheAppPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.GetTheAppPage })))
const HowItWorks = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.HowItWorks })))
const PromosPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.PromosPage })))
const RideTypesPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.RideTypesPage })))
const SafetyPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.SafetyPage })))
const SupportPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.SupportPage })))
const TigerPassPage = lazy(() => import('./screens/MarketingInfo').then((m) => ({ default: m.TigerPassPage })))
/** Rider booking, account and legal screens also load on demand so the marketing home paints fast. */
const PartnerJoin = lazy(() => import('./screens/RentalPartners').then((m) => ({ default: m.PartnerJoin })))
const PartnerDashboard = lazy(() => import('./screens/RentalPartners').then((m) => ({ default: m.PartnerDashboard })))
const DriverRentals = lazy(() => import('./screens/RentalPartners').then((m) => ({ default: m.DriverRentals })))
const RiderHome = lazy(() => import('./screens/RiderHome').then((m) => ({ default: m.RiderHome })))
const ConfirmPickup = lazy(() => import('./screens/ConfirmPickup').then((m) => ({ default: m.ConfirmPickup })))
const RideTiers = lazy(() => import('./screens/RideTiers').then((m) => ({ default: m.RideTiers })))
const ScheduleAirport = lazy(() => import('./screens/ScheduleAirport').then((m) => ({ default: m.ScheduleAirport })))
const FriendsScreen = lazy(() => import('./screens/FriendsAccount').then((m) => ({ default: m.FriendsScreen })))
const AccountScreen = lazy(() => import('./screens/FriendsAccount').then((m) => ({ default: m.AccountScreen })))
const SignInScreen = lazy(() => import('./screens/AuthScreens').then((m) => ({ default: m.SignInScreen })))
const SignUpScreen = lazy(() => import('./screens/AuthScreens').then((m) => ({ default: m.SignUpScreen })))
const DriverSignup = lazy(() => import('./screens/DriverSignup').then((m) => ({ default: m.DriverSignup })))
const PickDriver = lazy(() => import('./screens/PickDriver').then((m) => ({ default: m.PickDriver })))
const Requested = lazy(() => import('./screens/Requested').then((m) => ({ default: m.Requested })))
const LegalPrivacy = lazy(() => import('./screens/LegalPages').then((m) => ({ default: m.LegalPrivacy })))
const LegalTerms = lazy(() => import('./screens/LegalPages').then((m) => ({ default: m.LegalTerms })))
const ServiceArea = lazy(() => import('./screens/ServiceArea').then((m) => ({ default: m.ServiceArea })))
const LiveShare = lazy(() => import('./screens/LiveShare').then((m) => ({ default: m.LiveShare })))
const ProfileView = lazy(() => import('./screens/ProfileView').then((m) => ({ default: m.ProfileView })))
const RateRide = lazy(() => import('./screens/RateRide').then((m) => ({ default: m.RateRide })))
const TipRide = lazy(() => import('./screens/TipRide').then((m) => ({ default: m.TipRide })))
const ReceiptScreen = lazy(() => import('./screens/ReceiptScreen').then((m) => ({ default: m.ReceiptScreen })))
const FriendRideScreen = lazy(() => import('./screens/FriendRide').then((m) => ({ default: m.FriendRideScreen })))
const CarpoolScreen = lazy(() => import('./screens/CarpoolScreen').then((m) => ({ default: m.CarpoolScreen })))
const CarpoolHub = lazy(() => import('./screens/CarpoolHub').then((m) => ({ default: m.CarpoolHub })))
const PartyNightScreen = lazy(() => import('./screens/PartyNight').then((m) => ({ default: m.PartyNightScreen })))
const AmbassadorScreen = lazy(() => import('./screens/AmbassadorScreen').then((m) => ({ default: m.AmbassadorScreen })))
const AffiliatesScreen = lazy(() => import('./screens/Affiliates').then((m) => ({ default: m.AffiliatesScreen })))
const AffiliateLanding = lazy(() => import('./screens/Affiliates').then((m) => ({ default: m.AffiliateLanding })))
const LostFound = lazy(() => import('./screens/LostFound').then((m) => ({ default: m.LostFound })))
const RidesHistory = lazy(() => import('./screens/RidesHistory').then((m) => ({ default: m.RidesHistory })))
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
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><RideToastWatcher /></Suspense></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><RiderMatchPopup /></Suspense></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><WeeklyCouponNotice /></Suspense></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><DriverOfferWatcher /></Suspense></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><LostFoundWatcher /></Suspense></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><TripMessageBanner /></Suspense></AccessibleErrorBoundary>
          <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><RiderPickupStream /></Suspense></AccessibleErrorBoundary>
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
          {path === 'driver' && <AccessibleErrorBoundary fallback={() => null}><Suspense fallback={null}><DriverBillingEntry /></Suspense></AccessibleErrorBoundary>}
        </div>
      </div>
    </ToastProvider>
  )
}
