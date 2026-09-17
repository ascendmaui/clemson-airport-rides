import { useEffect, useState } from 'react'
import { getHashRoute } from './lib/navigation'
import { RequireAuth } from './components/RequireAuth'
import { Marketing } from './screens/Marketing'
import { RiderHome } from './screens/RiderHome'
import { ConfirmPickup } from './screens/ConfirmPickup'
import { RideTiers } from './screens/RideTiers'
import { ScheduleAirport } from './screens/ScheduleAirport'
import { DriverHome } from './screens/DriverHome'
import { FriendsScreen, AccountScreen } from './screens/StubTabs'
import { SignInScreen, SignUpScreen } from './screens/AuthScreens'
import { DriverOnboarding } from './screens/DriverOnboarding'
import { PickDriver } from './screens/PickDriver'

const PROTECTED = new Set(['home', 'rides', 'driver', 'schedule', 'confirm', 'tiers', 'pick-driver', 'driver-onboarding', 'friends', 'account'])

function Screen({ path, params }) {
  switch (path) {
    case 'landing':
    case '':
      return <Marketing />
    case 'sign-in':
      return <SignInScreen />
    case 'sign-up':
      return <SignUpScreen />
    case 'home':
    case 'rides':
      return (
        <RequireAuth>
          <RiderHome />
        </RequireAuth>
      )
    case 'confirm':
      return (
        <RequireAuth>
          <ConfirmPickup dest={params.dest || 'GSP Airport'} />
        </RequireAuth>
      )
    case 'tiers':
      return (
        <RequireAuth>
          <RideTiers dest={params.dest || '1900 GSP Dr'} />
        </RequireAuth>
      )
    case 'pick-driver':
      return (
        <RequireAuth>
          <PickDriver dest={params.dest || 'GSP Airport'} />
        </RequireAuth>
      )
    case 'schedule':
      return (
        <RequireAuth>
          <ScheduleAirport />
        </RequireAuth>
      )
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
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow,
          }}
          data-protected={PROTECTED.has(path) ? '1' : '0'}
        >
          <Screen path={path} params={params} />
        </div>
      </div>
    </div>
  )
}
