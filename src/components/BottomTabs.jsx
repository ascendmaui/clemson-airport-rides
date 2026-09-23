import { IconCar, IconCarpool, IconProfile, IconSchedule } from './icons'
import { navigate } from '../lib/navigation'

/** Exact four-tab bar: Schedule · Friends · Account · Rides */
const TABS = [
  { id: 'schedule', label: 'Schedule', Icon: IconSchedule },
  { id: 'friends', label: 'Friends', Icon: IconCarpool },
  { id: 'account', label: 'Account', Icon: IconProfile },
  { id: 'home', label: 'Rides', Icon: IconCar },
]

function goTab(id) {
  if (id === 'home' || id === 'rides') navigate('home')
  else navigate(id)
}

export function BottomTabs({ active, onChange }) {
  return (
    <nav className="tab-bar" aria-label="Main">
      {TABS.map((t) => {
        const isActive = active === t.id || (t.id === 'home' && active === 'rides')
        const Icon = t.Icon
        const color = isActive ? '#F56600' : '#8B939E'
        return (
          <button
            key={t.id}
            type="button"
            className={`tab-item pressable${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (onChange) onChange(t.id)
              else goTab(t.id)
            }}
          >
            <Icon size={22} color={color} />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
