import { useMemo, useState } from 'react'
import { SearchField } from '../components/SearchField'
import { Pill } from '../components/Pill'
import { BottomTabs } from '../components/BottomTabs'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { navigate } from '../lib/navigation'
import { DOWNTOWN_CENTER, downtownNow } from '../lib/downtownHeat'

const SHORTCUTS = [
  { id: 'home', label: 'Home', sub: 'Simpsonville', icon: '🏠' },
  { id: 'clemson', label: 'Clemson University', sub: 'Sikes Hall', icon: '🎓' },
  { id: 'work', label: 'Work', sub: 'Saved place', icon: '💼' },
]

export function RiderHome({ riderName = 'John' }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('home')
  const [downtown, setDowntown] = useState(true)
  const heat = useMemo(() => downtownNow(), [])

  const goSearch = (dest) => {
    navigate('confirm', { dest: dest || query || 'GSP Airport' })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'transparent' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        <header
          style={{
            position: 'relative',
            height: 200,
            background: `
              linear-gradient(180deg, rgba(11,18,32,0.05) 0%, rgba(82,45,128,0.45) 50%, rgba(11,18,32,0.88) 100%),
              linear-gradient(120deg, #c45a12 0%, #522D80 70%),
              url(https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200&q=80) center/cover
            `,
            color: '#fff',
            padding: '20px 20px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.18, fontSize: 72, lineHeight: 1, userSelect: 'none' }}>
            🐾
          </div>
          <div style={{ fontSize: 11, letterSpacing: 2.2, fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>
            RIDE • GAME • REPEAT
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
            <span style={{ color: '#FFB370' }}>Clemson</span>{' '}
            <span style={{ color: '#E8D5FF' }}>RIDES</span>
          </div>
          <div
            style={{
              marginTop: 8,
              alignSelf: 'flex-start',
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.28)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.7,
            }}
          >
            TIGERS GET YOU THERE
          </div>
        </header>

        <div style={{ padding: '20px 20px 0', position: 'relative' }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4 }}>
            Welcome, {riderName}
          </h1>
          <p style={{ color: 'var(--ink-secondary)', fontSize: 15, marginTop: 4, marginBottom: 16 }}>
            Where are you headed, Tiger?
          </p>

          <SearchField
            value={query}
            onChange={setQuery}
            onFocus={() => {}}
            orangeOutline
          />
          <div style={{ height: 8 }} />
          <button
            type="button"
            className="pressable"
            onClick={() => goSearch()}
            style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}
          >
            Search destination →
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
            <Pill icon="🕐" tone="orange" onClick={() => navigate('schedule')}>
              Schedule a ride
            </Pill>
            <Pill icon="👥" tone="purple" onClick={() => navigate('friends')}>
              Ride with friends
            </Pill>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, overflowX: 'auto' }}>
            {SHORTCUTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="pressable glass-panel card-soft"
                onClick={() => goSearch(s.sub)}
                style={{ flex: '0 0 auto', minWidth: 118, padding: '14px 14px', borderRadius: 16, textAlign: 'left' }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 2 }}>{s.sub}</div>
              </button>
            ))}
          </div>

          <div className="glass-panel card-soft" style={{ marginTop: 22, borderRadius: 18, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {downtown ? 'Downtown tonight' : 'You are here'}
              </span>
              <button
                type="button"
                className="pressable"
                onClick={() => setDowntown((v) => !v)}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange)' }}
              >
                {downtown ? 'Show campus' : 'Show downtown'}
              </button>
            </div>
            {downtown && (
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '0 4px 8px' }}>
                College Ave is <strong>{heat.label}</strong> for this hour — typical Fri/Sat night pattern, not live Uber demand.
              </div>
            )}
            <CampusMap
              height={180}
              showHeat={downtown}
              interactive={downtown}
              center={downtown ? DOWNTOWN_CENTER : STADIUM}
              zoom={downtown ? 16 : 14}
              marker={downtown ? DOWNTOWN_CENTER : STADIUM}
            />
          </div>

          <div
            className="glass-panel glass-panel--orange card-soft"
            style={{ marginTop: 18, marginBottom: 18, borderRadius: 18, padding: 16, display: 'flex', gap: 14, alignItems: 'center' }}
          >
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--orange-soft)', display: 'grid', placeItems: 'center', fontSize: 24, flexShrink: 0 }}>
              🏈
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Game Day Rides</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 2 }}>
                Skip the surge. Book ahead!
              </div>
            </div>
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('schedule')}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #522D80 0%, #F56600 100%)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: 'nowrap',
                boxShadow: 'var(--shadow-pill)',
              }}
            >
              Schedule Now
            </button>
          </div>
        </div>
      </div>

      <BottomTabs
        active={tab}
        onChange={(id) => {
          setTab(id)
          if (id === 'schedule') navigate('schedule')
          else if (id === 'friends') navigate('friends')
          else if (id === 'account') navigate('account')
          else navigate('home')
        }}
      />
    </div>
  )
}
