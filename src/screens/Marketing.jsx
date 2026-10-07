import { useEffect, useState } from 'react'
import { navigate } from '../lib/navigation'
import { PrimaryButton } from '../components/PrimaryButton'

const STADIUM = {
  src: '/marketing/clemson-memorial-stadium.jpg',
  alt: 'Clemson Memorial Stadium at night, the stands full under the lights',
}

function scrollToDownloads() {
  document.getElementById('get-the-app')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function useNavOverPage() {
  const [overPage, setOverPage] = useState(false)
  useEffect(() => {
    const nav = document.querySelector('.mkt-nav')
    const stage = document.querySelector('.mkt-stage')
    const scroller = nav?.closest('.app-shell') || null
    if (!stage) return undefined
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

export function Marketing() {
  const overPage = useNavOverPage()
  return (
    <div className="mkt fade-in">
      <header className={overPage ? 'mkt-nav mkt-nav--scrolled' : 'mkt-nav'}>
        <button type="button" className="mkt-brand pressable" onClick={() => navigate('landing')}>
          <span>Clemson RIDES</span>
        </button>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <button type="button" className="pressable" onClick={() => navigate('home')}>Book</button>
          <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
          <button type="button" className="pressable mkt-nav-cta" onClick={scrollToDownloads}>Get the App</button>
        </nav>
      </header>

      <section className="mkt-stage" aria-label="Book">
        <img className="mkt-stage-photo" src={STADIUM.src} alt={STADIUM.alt} />
        <div className="mkt-stage-shade" aria-hidden="true" />
        <div className="mkt-inner mkt-stage-copy">
          <h1>Where to?</h1>
          <div className="mkt-choices">
            <PrimaryButton onClick={() => navigate('home')}>Book a ride</PrimaryButton>
            <button
              type="button"
              className="mkt-ghost mkt-ghost--solid pressable"
              onClick={() => navigate('carpool', { hub: '1' })}
            >
              Book a carpool
            </button>
          </div>
        </div>
      </section>

      <footer className="mkt-footer" id="get-the-app">
        <div className="mkt-inner mkt-footer-inner">
          <span>Clemson RIDES</span>
          <nav aria-label="Footer">
            <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
            <button type="button" className="pressable" onClick={() => navigate('service-area')}>Service area</button>
            <button type="button" className="pressable" onClick={() => navigate('account', { tab: 'billing' })}>Tiger Pass</button>
            <button type="button" className="pressable" onClick={() => navigate('account', { tab: 'safety' })}>Safety</button>
            <button type="button" className="pressable" onClick={() => navigate('privacy')}>Privacy</button>
            <button type="button" className="pressable" onClick={() => navigate('terms')}>Terms</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
