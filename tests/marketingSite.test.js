import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { MARKETING_FEATURES } from '../shared/marketingFeatures.js'
import {
  ANDROID_STORE_URL,
  APP_DOWNLOADS,
  DRIVER_ANDROID_STORE_URL,
  DRIVER_IOS_STORE_URL,
  IOS_STORE_URL,
  RIDER_ANDROID_STORE_URL,
  RIDER_IOS_STORE_URL,
  SUPPORT_EMAIL,
  WEB_BOOK_URL,
  WEB_DRIVER_URL,
  WEB_ORIGIN,
  WEB_SCHEDULE_URL,
  publishedStoreUrl,
} from '../shared/productLinks.js'
import { qrMatrix } from '../src/lib/qrMatrix.js'

const EXPO_LINK = /expo\.dev|expo\.go|exp:\/\/|Expo Go/i

test('store listings stay unpublished until real URLs exist', () => {
  assert.equal(IOS_STORE_URL, null)
  assert.equal(ANDROID_STORE_URL, null)
  assert.equal(RIDER_IOS_STORE_URL, null)
  assert.equal(RIDER_ANDROID_STORE_URL, null)
  assert.equal(DRIVER_IOS_STORE_URL, null)
  assert.equal(DRIVER_ANDROID_STORE_URL, null)
  assert.equal(publishedStoreUrl('https://expo.dev/accounts/johnmatveyev/projects/clemson-rides-rider'), null)
  assert.equal(publishedStoreUrl('exp://127.0.0.1:8081'), null)
  assert.equal(publishedStoreUrl('https://expo.go'), null)
  assert.equal(APP_DOWNLOADS.length, 2)
  assert.equal(APP_DOWNLOADS[0].id, 'rider')
  assert.equal(APP_DOWNLOADS[0].href, 'https://clemsonrides.com/#/home')
  assert.equal(APP_DOWNLOADS[0].iosHref, 'https://clemsonrides.com/#/home')
  assert.equal(APP_DOWNLOADS[0].androidHref, 'https://clemsonrides.com/#/home')
  assert.equal(APP_DOWNLOADS[0].href, WEB_BOOK_URL)
  assert.equal(APP_DOWNLOADS[1].id, 'driver')
  assert.equal(APP_DOWNLOADS[1].href, 'https://clemsonrides.com/#/driver')
  assert.equal(APP_DOWNLOADS[1].iosHref, 'https://clemsonrides.com/#/driver')
  assert.equal(APP_DOWNLOADS[1].androidHref, 'https://clemsonrides.com/#/driver')
  assert.equal(APP_DOWNLOADS[1].href, WEB_DRIVER_URL)
  for (const app of APP_DOWNLOADS) {
    assert.match(app.iosNote, /not live yet/)
    assert.match(app.androidNote, /not live yet/)
    assert.match(app.blurb, /not live yet/)
    const targets = `${app.href} ${app.iosHref} ${app.androidHref} ${app.iosNote} ${app.androidNote} ${app.blurb}`
    assert.doesNotMatch(targets, EXPO_LINK)
    assert.doesNotMatch(targets, /apps\.apple\.com|play\.google\.com|testflight/)
    assert.match(app.href, /^https:\/\/clemsonrides\.com\//)
  }
})

test('marketing features match the shipped product', () => {
  assert.deepEqual(MARKETING_FEATURES.map((feature) => feature.title), [
    'Airport rides',
    'Student discount',
    'Game day',
    'Weekend and party',
    'Preferred drivers',
    'Schedule',
    'Real-time matching',
    'Live trip tracking',
  ])
  const airport = MARKETING_FEATURES.find((feature) => feature.id === 'airport')
  assert.match(airport.body, /pre-authorization hold/)
  assert.match(airport.body, /full fare is charged when the trip ends/)
  assert.doesNotMatch(airport.body, /25% deposit/)
  const student = MARKETING_FEATURES.find((feature) => feature.id === 'student')
  assert.match(student.body, /10% off Standard/)
  assert.match(student.body, /confirmed/)
  assert.match(student.body, /@clemson\.edu/)
  assert.match(student.body, /@g\.clemson\.edu/)
  assert.match(student.body, /Other ride types/)
  assert.match(student.body, /not included/)
  assert.doesNotMatch(student.body, /student flag/i)
  const preferred = MARKETING_FEATURES.find((feature) => feature.id === 'preferred')
  assert.match(preferred.body, /decline/i)
})

test('the marketing page is a ride or carpool entry and does not invent store ids', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const chrome = readFileSync(new URL('../src/components/MarketingChrome.jsx', import.meta.url), 'utf8')
  assert.match(chrome, /Get the App/)
  assert.match(source, /Book a ride/)
  assert.match(source, /Book a carpool/)
  assert.match(source, /Schedule for later/)
  assert.match(source, /navigate\('home'\)/)
  assert.match(source, /navigate\('home', \{ tier: 'carpool' \}\)/)
  assert.match(source, /navigate\('schedule'\)/)
  assert.doesNotMatch(source, /Nighttime safety|messagingGuide|HERO_COLLAGE|How it works/)
  assert.doesNotMatch(source, /const DOWNLOADS/)
  assert.doesNotMatch(source, /MARKETING_FEATURES/)
  assert.doesNotMatch(source, /STANDING_OFFERS/)
  assert.doesNotMatch(source, /currentWeeklyCoupon/)
  assert.doesNotMatch(source, /APP_DOWNLOADS/)
  assert.doesNotMatch(source, EXPO_LINK)
  assert.doesNotMatch(chrome, EXPO_LINK)
  assert.doesNotMatch(source, /RIDER_EXPO_PROJECT|DRIVER_EXPO_PROJECT/)
  assert.doesNotMatch(source, /apps\.apple\.com|play\.google\.com/)
  assert.doesNotMatch(source, /ae9bb5b6|a9cfec15/)
  assert.doesNotMatch(source, /projects\/clemson-airport-rides\/builds/)
  assert.doesNotMatch(source, /25% deposit/)
  assert.doesNotMatch(source, /Standard, Wait & Save, Extra Comfort/)
  const retiredFleet = new RegExp(['te' + 'sla', 'model' + ' 3', 'robo' + 'taxi', 'self' + '-driving'].join('|'), 'i')
  assert.equal(retiredFleet.test(source), false)
})

test('download QR codes are square modules for the public install links', () => {
  for (const href of [WEB_BOOK_URL, WEB_DRIVER_URL]) {
    const matrix = qrMatrix(href)
    assert.ok(matrix.size >= 21)
    assert.equal(matrix.size % 1, 0)
    assert.equal(matrix.cells.some(([x, y]) => x === 0 && y === 0), true)
    assert.equal(matrix.cells.every(([x, y]) => x < matrix.size && y < matrix.size), true)
  }
  const rider = APP_DOWNLOADS.find((app) => app.id === 'rider')
  const driver = APP_DOWNLOADS.find((app) => app.id === 'driver')
  assert.deepEqual(qrMatrix(rider.href), qrMatrix(WEB_BOOK_URL))
  assert.deepEqual(qrMatrix(driver.href), qrMatrix(WEB_DRIVER_URL))
})

test('marketing features exact copy snapshot', (t) => {
  t.assert.snapshot(MARKETING_FEATURES)
})

test('soft-launch web QR targets stable production book URL', () => {
  assert.equal(WEB_ORIGIN, 'https://clemsonrides.com')
  assert.equal(WEB_BOOK_URL, 'https://clemsonrides.com/#/home')
  assert.equal(WEB_SCHEDULE_URL, 'https://clemsonrides.com/#/schedule')
  assert.doesNotMatch(WEB_ORIGIN, /clemson-rides\.vercel\.app$/)
})

test('public support route has real support content and contact links', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const chrome = readFileSync(new URL('../src/components/MarketingChrome.jsx', import.meta.url), 'utf8')
  const info = readFileSync(new URL('../src/screens/MarketingInfo.jsx', import.meta.url), 'utf8')
  const siteRoutes = app.slice(app.indexOf('const SITE_ROUTES'), app.indexOf('function Screen'))
  const support = info.slice(info.indexOf('export function SupportPage()'), info.indexOf('export function GetTheAppPage()'))
  assert.match(siteRoutes, /'support'/)
  assert.match(app, /case 'support':\s*return <SupportPage \/>/)
  assert.match(app, /\bSupportPage,/)
  assert.match(chrome, /\{ id: 'support', label: 'Support' \},\s*\{ id: 'privacy'/)
  assert.match(support, /<MarketingChrome current="support">/)
  assert.match(support, /<PageHead kicker="Help" title="Support" \/>/)
  assert.match(info, /APP_DOWNLOADS, SUPPORT_EMAIL/)
  assert.match(support, /mailto:\$\{SUPPORT_EMAIL\}/)
  assert.equal(SUPPORT_EMAIL, 'rides@clemsonrides.com')
  for (const route of ['faq', 'privacy', 'terms']) {
    assert.match(support, new RegExp(`navigate\\('${route}'\\)`))
  }
})

test('marketing homepage uses the Death Valley photo and Clemson palette', () => {
  const source = readFileSync(new URL('../src/components/MarketingChrome.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  assert.match(source, /\/marketing\/clemson-memorial-stadium\.jpg/)
  assert.match(source, /Clemson Memorial Stadium/)
  assert.match(css, /#F56600/)
  assert.match(css, /#522D80/)
  assert.match(css, /position:\s*fixed/)
  assert.match(css, /mkt-stage-shade/)
  assert.doesNotMatch(css.split('/* Auth */')[0], /background:\s*#f6f7f8/)
})

test('marketing header keeps Book, Drive, and Get the App on a transparent bar', () => {
  const source = readFileSync(new URL('../src/components/MarketingChrome.jsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  const header = source.slice(source.indexOf('<header className='), source.indexOf('</header>'))
  const footer = source.slice(source.indexOf('<footer'), source.indexOf('</footer>'))
  assert.match(header, />Book</)
  assert.match(header, />Drive</)
  assert.match(header, />Get the App</)
  assert.match(header, /navigate\('home'\)/)
  assert.match(header, /navigate\('drive'\)/)
  assert.match(header, /navigate\('get-the-app'\)/)
  assert.doesNotMatch(header, /This week|Privacy|Terms|service-area|scrollToCoupon|scrollToDownloads/)
  assert.match(source, /How it works/)
  assert.match(source, /Ride types/)
  assert.match(source, /Airports/)
  assert.match(source, /Tiger Pass/)
  assert.match(source, /Safety/)
  assert.match(source, /Why Clemson/)
  assert.match(source, /why-clemson-rides/)
  assert.match(source, /Drive with us/)
  assert.match(source, /Promos/)
  assert.match(source, /FAQ/)
  assert.match(source, /Privacy/)
  assert.match(source, /Terms/)
  assert.match(source, /navigate\(item\.id\)/)
  assert.match(source, /aria-label="More"/)
  assert.doesNotMatch(footer, /This week/)
  assert.doesNotMatch(home, /mkt-spec|mkt-offers|mkt-grid|Buy the \$75/)
  const navRule = css.match(/body \.mkt-nav \{[^}]+\}/)
  assert.ok(navRule, 'marketing nav rule exists')
  assert.match(navRule[0], /background:\s*transparent/)
  assert.match(navRule[0], /box-shadow:\s*none/)
  assert.match(navRule[0], /border-bottom:\s*none/)
  assert.match(navRule[0], /text-shadow:\s*none/)
  assert.match(navRule[0], /filter:\s*none/)
  assert.doesNotMatch(navRule[0], /255,\s*255,\s*255/)
  const scrolled = css.match(/body \.mkt-nav\.mkt-nav--scrolled \{[^}]+\}/)
  assert.ok(scrolled, 'scrolled nav rule exists')
  assert.match(scrolled[0], /rgba\(82,\s*45,\s*128/)
  assert.match(scrolled[0], /box-shadow:\s*none/)
  assert.match(scrolled[0], /border-bottom:\s*none/)
  assert.match(scrolled[0], /backdrop-filter:\s*none/)
  assert.doesNotMatch(scrolled[0], /blur\(/)
  const labelRule = css.match(/body \.mkt-brand,\s*\nbody \.mkt-nav-links button \{[^}]+\}/)
  assert.ok(labelRule, 'nav label rule exists')
  assert.match(labelRule[0], /text-shadow:\s*none/)
})

test('marketing cards and buttons use frosted glass on phone and desktop', () => {
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  const marketing = css.slice(0, css.indexOf('/* Auth */'))
  const card = marketing.match(/body \.mkt-card,[\s\S]*?\{[^}]+\}/)
  assert.ok(card, 'shared card glass rule exists')
  assert.match(card[0], /background:\s*rgba\(255,\s*255,\s*255,\s*0\.16\)/)
  assert.match(card[0], /backdrop-filter:\s*blur\(16px\)/)
  assert.match(card[0], /-webkit-backdrop-filter:\s*blur\(16px\)/)
  assert.match(card[0], /border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.34\)/)
  assert.match(card[0], /box-shadow:\s*none/)
  assert.doesNotMatch(marketing, /@media \(max-width:\s*768px\)/)
  assert.match(marketing, /position:\s*fixed/)
  assert.match(marketing, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/)
  assert.match(marketing, /background:\s*rgba\(18,\s*10,\s*28,\s*0\.92\)/)
  assert.match(marketing, /font-size:\s*17px/)
  assert.match(marketing, /min-height:\s*44px/)
  assert.match(marketing, /min-height:\s*48px/)
  const cta = marketing.match(/body \.mkt \.primary-cta \{[^}]+\}/)
  assert.ok(cta, 'primary button rule exists')
  assert.match(cta[0], /rgba\(245,\s*102,\s*0,\s*0\.45\)/)
  assert.match(cta[0], /color:\s*#fff !important/)
  assert.match(cta[0], /box-shadow:\s*none !important/)
  assert.match(marketing, /rgba\(82,\s*45,\s*128,\s*0\.45\)/)
  const desktop = marketing.slice(marketing.indexOf('@media (min-width: 960px)'))
  assert.match(desktop, /font-size:\s*48px/)
  assert.doesNotMatch(desktop, /background:\s*#fff/)
  assert.doesNotMatch(card[0], /background:\s*#fff/)
})

test('marketing hero offers a ride, carpool booking, and the rider schedule', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.match(source, /HOMEPAGE_HEADLINE/)
  assert.match(source, /Book a ride/)
  assert.match(source, /Book a carpool/)
  assert.match(source, /Schedule for later/)
  assert.match(source, /navigate\('home'\)/)
  assert.match(source, /navigate\('home', \{ tier: 'carpool' \}\)/)
  assert.match(source, /navigate\('schedule'\)/)
  assert.doesNotMatch(source, /QrMark|WEB_BOOK_URL|Soft launch/)
})

test('hero collage leads with the street carpool photo and keeps the stadium', () => {
  const home = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../src/screens/MarketingInfo.jsx', import.meta.url), 'utf8')
  const images = readFileSync(new URL('../src/content/images.js', import.meta.url), 'utf8')
  const photo = readFileSync(new URL('../src/components/MarketingPhoto.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  assert.match(home, /HOMEPAGE_HEADLINE/)
  assert.match(home, /Book a carpool/)
  assert.match(home, /Schedule for later/)
  assert.doesNotMatch(home, /HERO_COLLAGE/)
  assert.match(home, /HOME_HERO/)
  assert.match(home, /mkt-hero-collage mkt-home-hero/)
  assert.match(source, /HERO_COLLAGE/)
  assert.match(images, /students-carpool-street-480\.webp \$\{width\}w|students-carpool-street/)
  const collage = images.slice(images.indexOf('HERO_COLLAGE'), images.indexOf('NIGHT_VENUES'))
  assert.match(collage, /students-carpool-street[\s\S]*students-stadium-request[\s\S]*students-carpool-backseat/)
  assert.doesNotMatch(collage, /airport-on-time/)
  const homeHero = images.slice(images.indexOf('HOME_HERO'), images.indexOf('FEATURE_IMAGES'))
  assert.match(homeHero, /students-carpool-street[\s\S]*students-stadium-request[\s\S]*airport-on-time/)
  assert.doesNotMatch(images, /unbranded\/students-carpool-street/)
  assert.match(source, /NIGHT_VENUES/)
  assert.match(source, /Downtown Clemson, Friday and Saturday nights/)
  assert.match(css, /scroll-snap-type:\s*x mandatory/)
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(images, /eager: true/)
  assert.match(photo, /width=\{1280\}/)
  assert.match(photo, /height=\{720\}/)
  assert.match(photo, /image\/webp/)
  assert.match(css, /object-position:\s*center 76%/)
  assert.match(css, /object-position:\s*center 62%/)
  assert.doesNotMatch(source, /weekend-night|airport-dropoff/)
  assert.doesNotMatch(images, /weekend-night|airport-dropoff/)
})

test('voice and audio recording is a live nighttime safety card', () => {
  const source = readFileSync(new URL('../src/screens/MarketingInfo.jsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const peace = readFileSync(new URL('../src/content/peaceOfMind.js', import.meta.url), 'utf8')
  const block = readFileSync(new URL('../src/components/FeatureBlock.jsx', import.meta.url), 'utf8')
  const images = readFileSync(new URL('../src/content/images.js', import.meta.url), 'utf8')
  const why = readFileSync(new URL('../src/screens/WhyClemsonRides.jsx', import.meta.url), 'utf8')
  assert.match(why, /Why Clemson Rides/)
  assert.match(peace, /Nighttime safety/)
  assert.match(peace, /Voice and audio recording/)
  assert.match(source, /SAFETY_FEATURES/)
  assert.doesNotMatch(home, /Nighttime safety/)
  assert.match(images, /\/images\/lifestyle\/safety-recording\.jpg/)
  assert.match(peace, /The rider starts it, only after a driver accepts/)
  assert.doesNotMatch(peace, /Recording starts once a driver has accepted/)
  assert.match(peace, /never uploaded/)
  assert.match(peace, /Audio recording is on/)
  assert.match(peace, /Video recording is on/)
  assert.match(peace, /banner stays up while it is recording/)
  assert.doesNotMatch(peace, /drivers record/)
  assert.match(block, /className="mkt-live">Live</)
  assert.match(block, /Coming soon/)
  assert.match(block, /case 'coming'/)
  const audio = peace.slice(peace.indexOf("id: 'audio-recording'"), peace.indexOf("id: 'live-tracking'"))
  assert.match(audio, /status: 'live'/)
  assert.doesNotMatch(audio, /status: 'coming'/)
  assert.match(peace, /id: 'backup-driver'[\s\S]*?status: 'live'/)
  assert.match(peace, /id: 'driver-confirm'[\s\S]*?status: 'live'/)
  assert.match(peace, /Confirm trip/)
  assert.match(peace, /\$10 or \$15/)
  assert.match(peace, /id: 'switch-cancel'[\s\S]*?status: 'live'/)
  assert.match(peace, /does not pair you with other riders/)
  assert.doesNotMatch(peace, /Carpool v1/)
  assert.match(peace, /id: 'boosts'[\s\S]*?status: 'live'/)
  assert.match(peace, /boostHowItWorks/)
  assert.doesNotMatch(peace, /only used if there's a safety report/)
  assert.doesNotMatch(source, /Uber|Lyft/)
})

test('messaging and lost item blocks are live and follow messagingGuide', async () => {
  const source = readFileSync(new URL('../src/screens/MarketingInfo.jsx', import.meta.url), 'utf8')
  const { messagingGuide, MESSAGING_SUMMARY, MESSAGING_LOST_ITEM_DAYS } = await import('../shared/copy/messaging.js')
  const guide = messagingGuide('rider')
  assert.match(source, /messagingGuide\('rider'\)/)
  const block = readFileSync(new URL('../src/components/FeatureBlock.jsx', import.meta.url), 'utf8')
  assert.match(block, /className="mkt-live">Live</)
  assert.equal(MESSAGING_LOST_ITEM_DAYS, 7)
  assert.match(guide.summary.join(' '), /after a driver accepts/)
  assert.match(guide.summary.join(' '), /during the ride/)
  assert.match(guide.summary.join(' '), /closes when the ride ends/)
  assert.match(guide.summary.join(' '), /lost item/)
  assert.equal(guide.summary.length, MESSAGING_SUMMARY.length)
  assert.match(guide.lostItemSteps.join(' '), /7 days/)
  assert.match(guide.lostItemSteps.join(' '), /marks it resolved/)
})

test('homepage carries the feature sections and the why page points back to them', async () => {
  const home = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const blocks = readFileSync(new URL('../src/components/FeatureSections.jsx', import.meta.url), 'utf8')
  const why = readFileSync(new URL('../src/screens/WhyClemsonRides.jsx', import.meta.url), 'utf8')
  const drive = readFileSync(new URL('../src/screens/DriveWithUs.jsx', import.meta.url), 'utf8')
  const copy = readFileSync(new URL('../src/content/differentiators.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  const { FEATURES, FEATURES_HEADING, ONLY_AT_CLEMSON_RIDES } = await import('../src/content/features.js')
  const {
    DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS,
    HOMEPAGE_HEADLINE,
    HOMEPAGE_SUBLINE,
    RIDER_DIFFERENTIATORS,
    DRIVER_EARNINGS,
  } = await import('../src/content/differentiators.js')
  assert.equal(DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS, true)
  assert.match(copy, /backup-queue/)
  assert.match(copy, /Do not publish this copy on production/)
  assert.equal(HOMEPAGE_HEADLINE, 'Peace of mind, every ride')
  assert.equal(HOMEPAGE_SUBLINE, "Drivers confirm before they come. A backup is ready if they don't.")
  assert.equal(FEATURES_HEADING, 'Peace of mind, built in')
  assert.match(home, /HOMEPAGE_HEADLINE/)
  assert.match(home, /HOMEPAGE_SUBLINE/)
  assert.match(home, /FeatureSections/)
  assert.match(home, /mkt-stage/)
  assert.match(home, /Book a ride/)
  assert.match(home, /mkt-book/)
  assert.match(home, /Download the app/)
  assert.match(home, /navigate\('get-the-app'\)/)
  assert.match(home, /Safe nights out/)
  assert.match(home, /navigate\('safety'\)/)
  assert.match(home, /navigate\('how-it-works', \{ section: 'carpool' \}\)/)
  assert.match(home, />Carpool</)
  assert.match(home, /Make your flight/)
  assert.match(home, /navigate\('service-area'\)/)
  assert.match(home, /Why Clemson Rides/)
  assert.match(home, /mkt-why-link/)
  assert.match(css, /align-items:\s*start/)
  assert.match(css, /white-space:\s*nowrap/)
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
  const chrome = readFileSync(new URL('../src/components/MarketingChrome.jsx', import.meta.url), 'utf8')
  assert.match(chrome, /scrollTo/)
  assert.match(why, /gameday-crowd/)
  assert.match(why, /day-from-campus/)
  assert.doesNotMatch(home, /How it works|DRIVER_EARNINGS|Backup pay|RIDER_DIFFERENTIATORS/)
  assert.match(blocks, /FEATURES/)
  assert.match(blocks, /mkt-card mkt-feature/)
  assert.match(blocks, /What it is/)
  assert.match(blocks, /How it works/)
  assert.match(blocks, /Why it matters/)
  assert.match(blocks, /mkt-guide/)
  assert.match(blocks, /<details className="mkt-how">/)
  assert.match(blocks, /min-width: 960px/)
  assert.match(why, /Peace of mind/)
  assert.match(why, /Why Clemson Rides/)
  assert.match(why, /FEATURES/)
  assert.match(why, /ONLY_AT_CLEMSON_RIDES/)
  assert.match(why, /generic rideshare/)
  assert.match(why, /Book a ride/)
  assert.doesNotMatch(why, /section: 'features'/)
  assert.doesNotMatch(why, /See the features/)
  assert.doesNotMatch(why, /Uber|Lyft/)
  assert.match(drive, /DRIVER_EARNINGS/)
  assert.match(drive, /Earn more on scheduled rides/)
  const desktop = css.slice(css.indexOf('@media (min-width: 960px)'))
  assert.match(desktop, /\.mkt-home \.mkt-feature-list/)
  assert.match(desktop, /grid-template-columns:\s*1fr 1fr/)
  assert.doesNotMatch(css.slice(0, css.indexOf('/* Auth */')), /@media \(max-width:\s*768px\)/)
  for (const item of FEATURES) {
    assert.ok(item.what)
    assert.ok(item.why)
    assert.ok(item.steps.length >= 3 && item.steps.length <= 5, item.id)
  }
  assert.deepEqual(FEATURES.map((item) => item.title), RIDER_DIFFERENTIATORS.map((item) => item.title))
  assert.deepEqual(RIDER_DIFFERENTIATORS.map((item) => item.title), [
    'Guaranteed pickup',
    'Drivers confirm before they come',
    'On-the-way alerts',
    'Switch or cancel, your call',
    'Boost your scheduled ride',
    'Message your driver',
    'Carpool',
    'Tiger Pass',
    'Tiger Heat',
    'Women-only',
    'Safety on the ride',
    'Favorite drivers',
    'Built for Clemson',
    'Airport rides',
    'Student price',
    'Game day',
    'Weekend and party',
  ])
  assert.deepEqual(
    RIDER_DIFFERENTIATORS.filter((item) => item.exclusive).map((item) => item.id),
    ['backup-driver', 'confirm'],
  )
  assert.equal(ONLY_AT_CLEMSON_RIDES, 'Only at Clemson Rides')
  assert.deepEqual(DRIVER_EARNINGS.map((item) => item.title), [
    'Keep the boost',
    'Backup pay',
    'Switch or cancel',
  ])
  const blob = `${JSON.stringify(FEATURES)} ${JSON.stringify(DRIVER_EARNINGS)} ${HOMEPAGE_HEADLINE} ${HOMEPAGE_SUBLINE}`
  assert.match(blob, /\$5, \$10, \$15, or \$20/)
  assert.match(blob, /\$10 or \$15/)
  assert.match(blob, /keeps all of it/)
  assert.match(blob, /lost item/)
  assert.match(blob, /5 minutes before pickup/)
  assert.match(blob, /never counts against/)
  assert.match(blob, /sit tight/)
  assert.doesNotMatch(blob, /25% deposit/)
  assert.doesNotMatch(blob, /Uber|Lyft/)
  const retiredFleet = new RegExp(['te' + 'sla', 'model' + ' 3', 'robo' + 'taxi', 'self' + '-driving'].join('|'), 'i')
  assert.equal(retiredFleet.test(blob), false)
  const exclusiveBodies = RIDER_DIFFERENTIATORS.filter((item) => item.exclusive).map((item) => item.body).join(' ')
  assert.equal((exclusiveBodies.match(/Only at/g) || []).length, 0)
})

test('homepage menu routes are real screens', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const info = readFileSync(new URL('../src/screens/MarketingInfo.jsx', import.meta.url), 'utf8')
  const area = readFileSync(new URL('../src/screens/ServiceArea.jsx', import.meta.url), 'utf8')
  for (const id of ['how-it-works', 'ride-types', 'service-area', 'tiger-pass', 'safety', 'why-clemson-rides', 'drive', 'promos', 'faq', 'privacy', 'terms', 'get-the-app']) {
    assert.match(app, new RegExp(`case '${id}':`))
  }
  assert.match(info, /CARPOOL_DISCOUNT_BPS \/ 100/)
  assert.match(info, /pre-authorization hold/)
  assert.doesNotMatch(info, /25% deposit/)
  assert.match(area, /AIRPORT_SECTION/)
  assert.match(area, /Schedule for later/)
})

test('unbranded mode hides lifestyle photos that have no twin', async () => {
  const { resolveMarketingImage } = await import('../shared/marketingImages.js')
  const branded = resolveMarketingImage('safety-recording', { branded: true })
  const hidden = resolveMarketingImage('safety-recording', { branded: false })
  const hero = resolveMarketingImage('students-carpool-street', { branded: false })
  const street = resolveMarketingImage('students-carpool-street', { branded: true })
  const studyhall = resolveMarketingImage('studyhall-corner-night', { branded: false })
  const studyhallNamed = resolveMarketingImage('studyhall-corner-night', { branded: true })
  const walkons = resolveMarketingImage('college-ave-csp-356-walkons', { branded: false })
  assert.match(branded.src, /\/images\/lifestyle\/safety-recording\.jpg/)
  assert.equal(hidden, null)
  assert.equal(hero, null)
  assert.match(street.src, /\/images\/hero\/students-carpool-street\.jpg/)
  assert.match(street.alt, /white SUV/)
  assert.match(street.srcSet, /students-carpool-street-480\.webp 480w/)
  assert.match(studyhall.src, /\/images\/unbranded\/college-ave-corner-night-line-nonames\.jpg/)
  assert.doesNotMatch(studyhall.alt, /Study Hall/)
  assert.match(studyhallNamed.alt, /Study Hall/)
  assert.equal(walkons, null)
})
