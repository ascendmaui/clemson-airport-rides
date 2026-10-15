import { useEffect, useRef, useState } from 'react'
import { navigate } from '../lib/navigation'
import { supportEmail } from '../../shared/productLinks.js'
import { SiteIcon } from './SiteIcon'

function SupportMailLink({ className = 'mkt-text pressable' }) {
  const email = supportEmail()
  return (
    <a className={className} href={`mailto:${email}`}>{email}</a>
  )
}

const STADIUM = {
  src: '/marketing/clemson-memorial-stadium.jpg',
  srcSet: '/marketing/clemson-memorial-stadium-960.webp 960w, /marketing/clemson-memorial-stadium-1600.webp 1600w, /marketing/clemson-memorial-stadium-2200.webp 2200w',
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
  { id: 'support', label: 'Support' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
]

/** Footer columns reuse the menu ids so every footer link is a real route. */
const FOOTER_COLUMNS = [
  { title: 'Ride', ids: ['how-it-works', 'ride-types', 'service-area', 'tiger-pass', 'promos'] },
  { title: 'Clemson Rides', ids: ['why-clemson-rides', 'safety', 'drive'] },
  { title: 'Help', ids: ['faq', 'support', 'privacy', 'terms'] },
]
const MENU_LABELS = new Map(MARKETING_MENU.map((item) => [item.id, item.label]))

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

/**
 * The stadium photo sits behind the page hero only. Measure where the hero
 * ends so the photo and its overlay stop there and the page below stays light.
 */
function useHeroHeight(rootRef) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const hero = root.querySelector('.mkt-stage, .mkt-page-hero')
    if (!hero) return undefined
    const apply = () => {
      const top = root.getBoundingClientRect().top
      const bottom = hero.getBoundingClientRect().bottom
      root.style.setProperty('--mkt-hero-h', `${Math.ceil(bottom - top)}px`)
    }
    apply()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(apply)
    observer.observe(hero)
    observer.observe(root)
    return () => observer.disconnect()
  }, [rootRef])
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

function SiteFooter({ current }) {
  const year = new Date().getFullYear()
  return (
    <footer className="mkt-footer site-footer">
      <div className="mkt-inner mkt-footer-inner site-container">
        <div className="site-footer-brand">
          <button type="button" className="site-footer-logo pressable" onClick={() => navigate('landing')}>
            <img src="/brand/rider-icon.svg" alt="" width="36" height="36" loading="lazy" />
            <span>Clemson Rides</span>
          </button>
          <p>Rides around campus, downtown, game day, and scheduled trips to GSP and CLT.</p>
          <SupportMailLink className="site-footer-mail pressable" />
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} className="site-footer-col" aria-label={column.title}>
            <p className="site-footer-title">{column.title}</p>
            <ul>
              {column.ids.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="pressable"
                    aria-current={current === id ? 'page' : undefined}
                    onClick={() => navigate(id)}
                  >
                    {MENU_LABELS.get(id)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="site-container site-footer-base">
        <span>© {year} Clemson Rides. Not an official Clemson University service.</span>
      </div>
    </footer>
  )
}

export function MarketingChrome({ current = '', home = false, children }) {
  const overPage = useNavOverPage()
  const menuRef = useRef(null)
  const rootRef = useRef(null)
  useHeroHeight(rootRef)
  const menu = (
    <nav className="mkt-menu" aria-label="More" ref={menuRef}>
      <MenuLinks current={current} menuRef={menuRef} />
    </nav>
  )
  return (
    <div ref={rootRef} className={home ? 'mkt mkt-home site fade-in' : 'mkt mkt-info site fade-in'}>
      <picture className="mkt-stage-picture">
        <source type="image/webp" srcSet={STADIUM.srcSet} sizes="100vw" />
        <img className="mkt-stage-photo" src={STADIUM.src} alt={STADIUM.alt} fetchpriority="high" decoding="async" />
      </picture>
      <div className="mkt-stage-shade" aria-hidden="true" />
      <header className={overPage ? 'mkt-nav mkt-nav--scrolled' : 'mkt-nav'}>
        <div className="site-nav-inner site-container">
          <button type="button" className="mkt-brand pressable" onClick={() => navigate('landing')}>
            <img className="mkt-brand-icon" src="/brand/rider-icon.svg" alt="" width="28" height="28" />
            <span>Clemson Rides</span>
          </button>
          <nav className="mkt-nav-links" aria-label="Marketing">
            <button type="button" className="pressable" onClick={() => navigate('home')}>Book</button>
            <button type="button" className="pressable" aria-current={current === 'drive' ? 'page' : undefined} onClick={() => navigate('drive')}>Drive</button>
            <button type="button" className="pressable mkt-nav-cta" aria-current={current === 'get-the-app' ? 'page' : undefined} onClick={() => navigate('get-the-app')}>
              <span>Get the App</span>
              <SiteIcon name="arrow-right" size={16} />
            </button>
          </nav>
        </div>
      </header>
      {home ? (
        <>
          {children}
          <SiteFooter current={current} />
        </>
      ) : (
        <>
          <div className="mkt-footer mkt-menu-bar">
            <div className="site-container site-menu-inner">{menu}</div>
          </div>
          <main className="mkt-inner mkt-main mkt-page site-container">{children}</main>
          <SiteFooter current={current} />
        </>
      )}
    </div>
  )
}
