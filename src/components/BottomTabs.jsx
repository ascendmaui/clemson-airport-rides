const TABS = [
  { id: 'home', label: 'Rides', icon: '🚗' },
  { id: 'schedule', label: 'Schedule', icon: '📅' },
  { id: 'friends', label: 'Friends', icon: '👥' },
  { id: 'account', label: 'Account', icon: '👤' },
]

export function BottomTabs({ active, onChange }) {
  return (
    <nav className="tab-bar">
      {TABS.map((t) => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            className={`tab-item pressable${isActive ? ' active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
