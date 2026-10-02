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
  const handleKeyDown = (e) => {
    const currentIndex = TABS.findIndex((t) => t.id === active || (t.id === 'home' && active === 'rides'))
    if (currentIndex === -1) return
    let nextIndex = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % TABS.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length
    } else if (e.key === 'Home') {
      nextIndex = 0
    } else if (e.key === 'End') {
      nextIndex = TABS.length - 1
    }
    if (nextIndex !== -1 && nextIndex !== currentIndex) {
      e.preventDefault()
      const nextTab = TABS[nextIndex]
      if (onChange) onChange(nextTab.id)
      else goTab(nextTab.id)
      if (typeof document !== 'undefined') {
        const el = document.getElementById(`bottom-tab-${nextTab.id}`)
        el?.focus()
      }
    }
  }

  return (
    <nav className="tab-bar" aria-label="Main" onKeyDown={handleKeyDown}>
      {TABS.map((t) => {
        const isActive = active === t.id || (t.id === 'home' && active === 'rides')
        const Icon = t.Icon
        const color = isActive ? '#F56600' : '#8B939E'
        return (
          <button
            key={t.id}
            id={`bottom-tab-${t.id}`}
            type="button"
            className={`tab-item pressable${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (onChange) onChange(t.id)
              else goTab(t.id)
            }}
          >
            <Icon size={22} color={color} aria-hidden="true" />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
