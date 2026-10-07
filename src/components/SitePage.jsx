import { navigate } from '../lib/navigation'
import { APP_STORE_NOTE } from '../content/peaceOfMind.js'

function scrollToDownloads() {
  document.getElementById('get-the-app')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function SitePage({ children }) {
  return (
    <div className="mkt fade-in">
      <header className="mkt-nav mkt-nav--scrolled">
        <button type="button" className="mkt-brand pressable" onClick={() => navigate('landing')}>
          <span>Clemson RIDES</span>
        </button>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <button type="button" className="pressable" onClick={() => navigate('home')}>Book</button>
          <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
          <button type="button" className="pressable mkt-nav-cta" onClick={scrollToDownloads}>Get the App</button>
        </nav>
      </header>
      <main className="mkt-inner mkt-main">
        {children}
      </main>
      <footer className="mkt-footer" id="get-the-app">
        <div className="mkt-inner mkt-footer-inner">
          <span>Clemson RIDES</span>
          <p>{APP_STORE_NOTE}</p>
          <nav aria-label="Footer">
            <button type="button" className="pressable" onClick={() => navigate('home')}>Book a ride</button>
            <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
            <button type="button" className="pressable" onClick={() => navigate('privacy')}>Privacy</button>
            <button type="button" className="pressable" onClick={() => navigate('terms')}>Terms</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
