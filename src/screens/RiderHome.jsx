import { useEffect, useState } from 'react'
import { SearchField } from '../components/SearchField'
import { Pill } from '../components/Pill'
import { BottomTabs } from '../components/BottomTabs'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { navigate } from '../lib/navigation'
import { DOWNTOWN_CENTER } from '../lib/downtownHeat'
import { HEAT_WINDOWS } from '../lib/rideDemand'
import { quoteWithSurge } from '../lib/pricing'
import { SurgeBadge } from '../components/SurgeBadge'

const SHORTCUTS = [
  { id: 'home', label: 'Home', sub: 'Simpsonville', icon: '🏠' },
  { id: 'clemson', label: 'Clemson University', sub: 'Sikes Hall', icon: '🎓' },
  { id: 'work', label: 'Work', sub: 'Saved place', icon: '💼' },
]

export function RiderHome({ riderName = 'John' }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('home')
  const [showBusy, setShowBusy] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [surge, setSurge] = useState(null)

  useEffect(() => {
    let alive = true
    quoteWithSurge({ airport: true, miles: 48, minutes: 55 })
      .then((q) => { if (alive) setSurge(q.surge) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const [heatMeta, setHeatMeta] = useState(null)
  const goSearch = (dest) => {
    navigate('confirm', { dest: dest || query || 'GSP Airport' })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'transparent' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        <div style={{ padding: '14px 20px 0' }}>
          <header
            style={{
              position: 'relative',
              width: '50%',
              maxWidth: 220,
              minHeight: 96,
              borderRadius: 18,
              background: '#F56600',
              boxShadow: '0 10px 28px -12px rgba(245,102,0,0.55), 0 4px 12px -6px rgba(82,45,128,0.25)',
              color: '#fff',
              padding: '14px 16px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', top: 8, right: 10, opacity: 0.22, fontSize: 36, lineHeight: 1, userSelect: 'none' }}>
              🐾
            </div>
            <div style={{ position: 'relative', fontSize: 9, letterSpacing: 1.6, fontWeight: 700, opacity: 0.9, marginBottom: 4 }}>
              RIDE • GAME • REPEAT
            </div>
            <div style={{ position: 'relative', fontSize: 18, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.15 }}>
              Clemson <span style={{ fontWeight: 700, opacity: 0.95 }}>RIDES</span>
            </div>
            <div
              style={{
                position: 'relative',
                marginTop: 8,
                alignSelf: 'flex-start',
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.32)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.6,
              }}
            >
              TIGERS GET YOU THERE
            </div>
          </header>
        </div>

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 4px', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Campus map</span>
              <button type="button" className="pressable" onClick={() => setShowBusy((v) => !v)}
                style={{ fontSize: 12, fontWeight: 700, color: showBusy ? '#fff' : 'var(--purple)',
                  background: showBusy ? 'linear-gradient(135deg, #522D80 0%, #F56600 100%)' : 'var(--purple-soft)',
                  border: '1px solid rgba(82,45,128,0.35)', borderRadius: 999, padding: '6px 12px' }}>
                {showBusy ? 'Busy Areas · On' : 'Busy Areas · Off'}
              </button>
            </div>
            {showBusy && (
              <>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 4px 8px' }}>
                  {HEAT_WINDOWS.map((w) => (
                    <button key={w.id} type="button" className="pressable" onClick={() => setHeatWindow(w.id)}
                      style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 999,
                        border: `1px solid ${heatWindow === w.id ? 'rgba(245,102,0,0.55)' : 'rgba(82,45,128,0.25)'}`,
                        background: heatWindow === w.id ? 'var(--orange-soft)' : 'var(--surface)',
                        color: heatWindow === w.id ? 'var(--orange)' : 'var(--purple)' }}>
                      {w.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '0 4px 8px' }}>
                  {heatMeta?.caption || 'Popular campus spots from ride requests — dorms, downtown, stadium.'}
                  {heatMeta?.blended ? <span style={{ marginLeft: 6, fontWeight: 700, color: 'var(--purple)' }}>Live + typical</span> : null}
                </div>
              </>
            )}
            <CampusMap height={180} showHeat={showBusy} heatMode="busy" heatWindow={heatWindow}
              onHeatMeta={setHeatMeta} showMapTypeControl interactive={showBusy}
              center={showBusy ? DOWNTOWN_CENTER : STADIUM} zoom={showBusy ? 15 : 14}
              marker={showBusy ? DOWNTOWN_CENTER : STADIUM} />
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
                {surge?.multiplier > 1
                  ? 'Surge is on — drivers earn more, fares include the multiplier.'
                  : 'Book ahead. Surge turns on for airport rush, weekends, and game days.'}
              </div>
              <div style={{ marginTop: 6 }}><SurgeBadge surge={surge} /></div>
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
