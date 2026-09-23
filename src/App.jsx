import { useEffect, useState } from 'react'
import { getHashRoute, redirectShareHashToPath } from './lib/navigation'
import { RequireAuth } from './components/RequireAuth'
import { Marketing } from './screens/Marketing'
import { RiderHome } from './screens/RiderHome'
import { ConfirmPickup } from './screens/ConfirmPickup'
import { RideTiers } from './screens/RideTiers'
import { ScheduleAirport } from './screens/ScheduleAirport'
import { DriverHome } from './screens/DriverHome'
import { FriendsScreen, AccountScreen } from './screens/FriendsAccount'
import { SignInScreen, SignUpScreen } from './screens/AuthScreens'
import { DriverOnboarding } from './screens/DriverOnboarding'
import { DriverSignup } from './screens/DriverSignup'
import { PickDriver } from './screens/PickDriver'
import { Requested } from './screens/Requested'
import { LegalPrivacy, LegalTerms } from './screens/LegalPages'
import { LiveShare } from './screens/LiveShare'
import { ProfileView } from './screens/ProfileView'
import { RateRide } from './screens/RateRide'
import { FriendRideScreen } from './screens/FriendRide'
import { CarpoolScreen } from './screens/CarpoolScreen'
import { ToastProvider, ToastStack } from './lib/toasts'
import { RideToastWatcher } from './components/RideToastWatcher'

const PROTECTED = new Set(['driver', 'driver-onboarding', 'account', 'driver-signup'])

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
    case 'share':
    case 'live':
      return <LiveShare token={params.token || ''} />
    case 'profile':
      return <ProfileView />
    case 'rate':
      return <RateRide />
    case 'home':
    case 'rides':
      return <RiderHome />
    case 'confirm':
      return <ConfirmPickup dest={params.dest || 'GSP Airport'} />
    case 'tiers':
      return <RideTiers dest={params.dest || '1900 GSP Dr'} />
    case 'pick-driver':
      return <PickDriver dest={params.dest || 'GSP Airport'} />
    case 'requested':
      return <Requested dest={params.dest} trip={params.trip} driver={params.driver} />
    case 'schedule':
      return <ScheduleAirport />
    case 'driver':
      return (
        <RequireAuth>
          <DriverHome />
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
      return <CarpoolScreen token={params.token || ''} />
    case 'account':
      return (
        <RequireAuth>
          <AccountScreen />
        </RequireAuth>
      )
    default:
      return <Marketing />
  }
}

export default function App() {
  const [{ path, params }, setRoute] = useState(() => getHashRoute())

  useEffect(() => {
    if (redirectShareHashToPath()) return undefined
    const onRoute = () => {
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

  const overflow = path === 'driver' ? 'hidden' : 'auto'

  return (
    <ToastProvider>
      <div className="desktop-frame">
        <div className="app-shell" style={{ position: 'relative', height: '100%' }}>
          <RideToastWatcher />
          <ToastStack />
          <div
            key={`${path}:${params.token || params.id || params.trip || ''}`}
            className="route-fade"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow }}
            data-protected={PROTECTED.has(path) ? '1' : '0'}
            data-guest-browse={PROTECTED.has(path) ? '0' : '1'}
            data-route={path}
          >
            <Screen path={path} params={params} />
          </div>
        </div>
      </div>
    </ToastProvider>
  )
}
