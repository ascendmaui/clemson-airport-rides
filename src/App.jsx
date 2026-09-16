import { useEffect, useState } from 'react'
import { getHashRoute } from './lib/navigation'
import { Marketing } from './screens/Marketing'
import { RiderHome } from './screens/RiderHome'
import { ConfirmPickup } from './screens/ConfirmPickup'
import { RideTiers } from './screens/RideTiers'
import { ScheduleAirport } from './screens/ScheduleAirport'
import { DriverHome } from './screens/DriverHome'
import { FriendsScreen, AccountScreen } from './screens/StubTabs'

function Screen({ path, params }) {
  switch (path) {
    case 'landing':
    case '':
      return <Marketing />
    case 'home':
    case 'rides':
      return <RiderHome />
    case 'confirm':
      return <ConfirmPickup dest={params.dest || 'GSP Airport'} />
    case 'tiers':
      return <RideTiers dest={params.dest || '1900 GSP Dr'} />
    case 'schedule':
      return <ScheduleAirport />
    case 'driver':
      return <DriverHome />
    case 'friends':
      return <FriendsScreen />
    case 'account':
      return <AccountScreen />
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

  return (
    <div className="desktop-frame">
      <div className="app-shell">
        <div key={path} className="route-fade" style={{ height: '100%' }}>
          <Screen path={path} params={params} />
        </div>
      </div>
    </div>
  )
}
