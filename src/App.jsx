import { useEffect, useState } from 'react'
import { getHashRoute } from './lib/navigation'
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
import { PickDriver } from './screens/PickDriver'
import { Requested } from './screens/Requested'
import { LegalPrivacy, LegalTerms } from './screens/LegalPages'

const PROTECTED = new Set(['driver', 'driver-onboarding', 'friends', 'account'])

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
    case 'friends':
      return (
        <RequireAuth>
          <FriendsScreen />
        </RequireAuth>
      )
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
  const [{ path, params }, setRoute] = useState(getHashRoute)

  useEffect(() => {
    const onHash = () => setRoute(getHashRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const overflow = path === 'driver' ? 'hidden' : 'auto'

  return (
    <div className="desktop-frame">
      <div className="app-shell" style={{ position: 'relative', height: '100%' }}>
        <div
          key={path}
          className="route-fade"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow }}
          data-protected={PROTECTED.has(path) ? '1' : '0'}
          data-guest-browse={PROTECTED.has(path) ? '0' : '1'}
        >
          <Screen path={path} params={params} />
        </div>
      </div>
    </div>
  )
}
