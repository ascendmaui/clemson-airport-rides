/**
 * Demo map cars. Client markers only. They are not driver profiles, they are
 * not stored, and they never count toward availability, matching, ETA, or price.
 * Brooke is the only wedge-shaped demo car.
 */
export const DEMO_HIDE_NEAR_METERS = 200

export const DEMO_FLEET = [
  {
    id: 'demo-marcus',
    firstName: 'Marcus',
    make: 'BMW',
    model: 'X5',
    vehicle: 'BMW X5',
    year: 2025,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple BMW X5',
    photo: '/demo-drivers/01-marcus.webp',
    photoSmall: '/demo-drivers/01-marcus@128.webp',
  },
  {
    id: 'demo-jenna',
    firstName: 'Jenna',
    make: 'Mercedes',
    model: 'GLE',
    vehicle: 'Mercedes GLE',
    year: 2024,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Mercedes GLE',
    photo: '/demo-drivers/02-jenna.webp',
    photoSmall: '/demo-drivers/02-jenna@128.webp',
  },
  {
    id: 'demo-darnell',
    firstName: 'Darnell',
    make: 'Audi',
    model: 'Q7',
    vehicle: 'Audi Q7',
    year: 2026,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Audi Q7',
    photo: '/demo-drivers/03-darnell.webp',
    photoSmall: '/demo-drivers/03-darnell@128.webp',
  },
  {
    id: 'demo-priya',
    firstName: 'Priya',
    make: 'Range Rover',
    model: 'Sport',
    vehicle: 'Range Rover Sport',
    year: 2025,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Range Rover Sport',
    photo: '/demo-drivers/04-priya.webp',
    photoSmall: '/demo-drivers/04-priya@128.webp',
  },
  {
    id: 'demo-carlos',
    firstName: 'Carlos',
    make: 'Lexus',
    model: 'RX',
    vehicle: 'Lexus RX',
    year: 2024,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Lexus RX',
    photo: '/demo-drivers/05-carlos.webp',
    photoSmall: '/demo-drivers/05-carlos@128.webp',
  },
  {
    id: 'demo-hannah',
    firstName: 'Hannah',
    make: 'Porsche',
    model: 'Macan',
    vehicle: 'Porsche Macan',
    year: 2026,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Porsche Macan',
    photo: '/demo-drivers/06-hannah.webp',
    photoSmall: '/demo-drivers/06-hannah@128.webp',
  },
  {
    id: 'demo-terrence',
    firstName: 'Terrence',
    make: 'Cadillac',
    model: 'Escalade',
    vehicle: 'Cadillac Escalade',
    year: 2025,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Cadillac Escalade',
    photo: '/demo-drivers/07-terrence.webp',
    photoSmall: '/demo-drivers/07-terrence@128.webp',
  },
  {
    id: 'demo-mei',
    firstName: 'Mei',
    make: 'Genesis',
    model: 'GV80',
    vehicle: 'Genesis GV80',
    year: 2024,
    body: 'suv',
    livery: 'tiger',
    colorName: 'Orange & Purple',
    label: 'Orange & Purple Genesis GV80',
    photo: '/demo-drivers/08-mei.webp',
    photoSmall: '/demo-drivers/08-mei@128.webp',
  },
  {
    id: 'demo-wade',
    firstName: 'Wade',
    make: 'Ford',
    model: 'F-150',
    vehicle: 'Ford F-150',
    year: 2025,
    body: 'truck',
    livery: 'f150-white',
    colorName: 'White',
    label: 'White Ford F-150',
    photo: '/demo-drivers/09-wade.webp',
    photoSmall: '/demo-drivers/09-wade@128.webp',
  },
  {
    id: 'demo-tasha',
    firstName: 'Tasha',
    make: 'Ford',
    model: 'F-150',
    vehicle: 'Ford F-150',
    year: 2026,
    body: 'truck',
    livery: 'f150-orange',
    colorName: 'Orange',
    label: 'Orange Ford F-150',
    photo: '/demo-drivers/10-tasha.webp',
    photoSmall: '/demo-drivers/10-tasha@128.webp',
  },
  {
    id: 'demo-luis',
    firstName: 'Luis',
    make: 'Ford',
    model: 'F-150',
    vehicle: 'Ford F-150',
    year: 2024,
    body: 'truck',
    livery: 'f150-purple',
    colorName: 'Purple',
    label: 'Purple Ford F-150',
    photo: '/demo-drivers/11-luis.webp',
    photoSmall: '/demo-drivers/11-luis@128.webp',
  },
  {
    id: 'demo-brooke',
    firstName: 'Brooke',
    make: 'Tesla',
    model: 'Cybertruck',
    vehicle: 'Tesla Cybertruck',
    year: 2025,
    body: 'wedge',
    livery: 'wedge',
    colorName: 'Silver',
    label: 'Cybertruck',
    photo: '/demo-drivers/12-brooke.webp',
    photoSmall: '/demo-drivers/12-brooke@128.webp',
  },
].map((row) => ({
  ...row,
  isDemo: true,
  source: 'demo',
  bookable: false,
  online: false,
}))

const BY_ID = new Map(DEMO_FLEET.map((row) => [row.id, row]))

function demoIdKey(id) {
  return String(id || '').trim()
}

export function demoDriverById(id) {
  return BY_ID.get(demoIdKey(id)) || null
}

export function isDemoDriverId(id) {
  return BY_ID.has(demoIdKey(id))
}

// Site-relative demo files only. Rejects traversal, queries, and off-site URLs.
const DEMO_HEADSHOT_PATH = /^\/demo-drivers\/[A-Za-z0-9@._-]+$/

function demoHeadshotPath(value) {
  const url = String(value ?? '').trim()
  if (!DEMO_HEADSHOT_PATH.test(url)) return ''
  const name = url.slice('/demo-drivers/'.length)
  if (name === '.' || name === '..' || name.includes('..')) return ''
  return url
}

function firstDemoHeadshot(values) {
  for (const value of values) {
    const url = demoHeadshotPath(value)
    if (url) return url
  }
  return null
}

/**
 * Marker badges use the @128 file. Pass 'large' for the profile card.
 * A catalog row wins over a caller-supplied path. Real drivers return null.
 * A string id is accepted. Blank, padded, and unsafe values are skipped.
 */
export function demoHeadshotUrl(driver, size = 'small') {
  if (driver == null || typeof driver !== 'object') {
    const catalog = demoDriverById(driver)
    if (!catalog) return null
    const ordered = size === 'large'
      ? [catalog.photo, catalog.photoSmall]
      : [catalog.photoSmall, catalog.photo]
    return firstDemoHeadshot(ordered)
  }
  const catalog = demoDriverById(driver.id)
  const marked = driver.isDemo === true || driver.source === 'demo' || Boolean(catalog)
  if (!marked) return null
  const ordered = size === 'large'
    ? [catalog?.photo, catalog?.photoSmall, driver.photo, driver.photoSmall]
    : [catalog?.photoSmall, catalog?.photo, driver.photoSmall, driver.photo]
  return firstDemoHeadshot(ordered)
}
