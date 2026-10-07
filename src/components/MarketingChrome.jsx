import { useEffect, useRef, useState } from 'react'
import { navigate } from '../lib/navigation'

const STADIUM = {
  src: '/marketing/clemson-memorial-stadium.jpg',
  alt: 'Clemson Memorial Stadium at night, the stands full under the lights',
}

/** Info pages linked from the homepage menu. The top nav stays Book, Drive, and Get the App. */
export const MARKETING_MENU = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'ride-types', label: 'Ride types' },
  { id: 'service-area', label: 'Airports' },
  { id: 'tiger-pass', label: 'Tiger Pass' },
  { id: 'safety', label: 'Safety' },
  { id: 'why-clemson-rides', label: 'Why Clemson' },
  { id: 'drive', label: 'Drive with us' },
  { id: 'promos', label: 'Promos' },
  { id: 'faq', label: 'FAQ' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
]

function useNavOverPage() {
  const [overPage, setOverPage] = useState(false)
  useEffect(() => {
    const nav = document.querySelector('.mkt-nav')
    const scroller = nav?.closest('.app-shell') || null
    const read = () => {
      const top = scroller ? scroller.scrollTop : window.scrollY
      setOverPage(top > 12)
    }
    read()
    const target = scroller || window
    target.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      target.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [])
  return overPage
}

function MenuLinks({ current, menuRef }) {
  useEffect(() => {
    const menu = menuRef.current
    if (!menu || !current) return undefined
    const frame = window.requestAnimationFrame(() => {
      const button = menu.querySelector('[aria-current="page"]')
      if (!button) return
      const left = button.offsetLeft - (menu.clientWidth - button.offsetWidth) / 2
      menu.scrollTo({ left: Math.max(0, left) })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [current, menuRef])

  return MARKETING_MENU.map((item) => (
    <button
      key={item.id}
      type="button"
      className="pressable"
      aria-current={current === item.id ? 'page' : undefined}
      onClick={() => navigate(item.id)}
    >
      {item.label}
    </button>
  ))
}

export function MarketingChrome({ current = '', home = false, children }) {
  const overPage = useNavOverPage()
  const menuRef = useRef(null)
  const menu = (
    <nav className="mkt-menu" aria-label="More" ref={menuRef}>
      <MenuLinks current={current} menuRef={menuRef} />
    </nav>
  )
  return (
    <div className={home ? 'mkt mkt-home fade-in' : 'mkt mkt-info fade-in'}>
      <img className="mkt-stage-photo" src={STADIUM.src} alt={STADIUM.alt} />
      <div className="mkt-stage-shade" aria-hidden="true" />
      <header className={overPage ? 'mkt-nav mkt-nav--scrolled' : 'mkt-nav'}>
        <button type="button" className="mkt-brand pressable" onClick={() => navigate('landing')}>
          <span>Clemson RIDES</span>
        </button>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <button type="button" className="pressable" onClick={() => navigate('home')}>Book</button>
          <button type="button" className="pressable" aria-current={current === 'drive' ? 'page' : undefined} onClick={() => navigate('drive')}>Drive</button>
          <button type="button" className="pressable mkt-nav-cta" aria-current={current === 'get-the-app' ? 'page' : undefined} onClick={() => navigate('get-the-app')}>Get the App</button>
        </nav>
      </header>
      {home ? (
        <>
          {children}
          <footer className="mkt-footer">
            <div className="mkt-inner mkt-footer-inner">
              <span>Clemson RIDES</span>
              {menu}
            </div>
          </footer>
        </>
      ) : (
        <>
          <div className="mkt-footer mkt-menu-bar">{menu}</div>
          <main className="mkt-inner mkt-main mkt-page">{children}</main>
        </>
      )}
    </div>
  )
}
