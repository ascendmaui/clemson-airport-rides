import { IconCar, IconCarpool, IconProfile, IconSchedule } from './icons'

const TABS = [
  { id: 'home', label: 'Rides', Icon: IconCar },
  { id: 'schedule', label: 'Schedule', Icon: IconSchedule },
  { id: 'friends', label: 'Friends', Icon: IconCarpool },
  { id: 'account', label: 'Account', Icon: IconProfile },
]

export function BottomTabs({ active, onChange }) {
  return (
    <nav className="tab-bar">
      {TABS.map((t) => {
        const isActive = active === t.id
        const Icon = t.Icon
        const color = isActive ? '#F56600' : '#8B939E'
        return (
          <button
            key={t.id}
            type="button"
            className={`tab-item pressable${isActive ? ' active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            <Icon size={22} color={color} />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
