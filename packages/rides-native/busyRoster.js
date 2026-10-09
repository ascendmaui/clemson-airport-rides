/** Display-only roster. Identities and ordering never depend on the clock. */
const SEED = [
  ['Avery B.', 'Honda', 'Civic', 'Silver'],
  ['Malik J.', 'Toyota', 'Camry', 'Blue'],
  ['Sofia R.', 'Hyundai', 'Elantra', 'White'],
  ['Ethan W.', 'Subaru', 'Outback', 'Green'],
  ['Jasmine C.', 'Ford', 'Escape', 'Gray'],
  ['Daniel K.', 'Kia', 'Sorento', 'Black'],
  ['Camila M.', 'Nissan', 'Altima', 'Red'],
  ['Noah T.', 'Mazda', 'CX-5', 'Blue'],
  ['Aaliyah S.', 'Chevrolet', 'Equinox', 'Silver'],
  ['Owen H.', 'Toyota', 'RAV4', 'White'],
  ['Priya D.', 'Honda', 'CR-V', 'Gray'],
  ['Isaiah L.', 'Jeep', 'Cherokee', 'Black'],
  ['Grace P.', 'Honda', 'Accord', 'Blue'],
  ['Mateo V.', 'Toyota', 'Corolla', 'Silver'],
  ['Chloe N.', 'Hyundai', 'Tucson', 'White'],
  ['Andre F.', 'Subaru', 'Forester', 'Green'],
  ['Hannah G.', 'Ford', 'Fusion', 'Red'],
  ['Luis A.', 'Kia', 'Sportage', 'Gray'],
  ['Mei Z.', 'Nissan', 'Rogue', 'Blue'],
  ['Caleb E.', 'Mazda', 'Mazda3', 'Black'],
]

function seededHash(text) {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

const ROSTER = SEED.map(([name, make, model, color], index) => {
  const hash = seededHash(`clemson-roster-${name}`)
  return Object.freeze({
    id: `sim-busy-${index + 1}`,
    name,
    rating: (4.6 + (hash % 5) / 10).toFixed(1),
    tripCount: 40 + (hash % 1861),
    make, model, color,
    vehicleLabel: `${color} ${make} ${model}`,
    online: false,
    bookable: false,
  })
})

export function isBusyRosterId(id) {
  return typeof id === 'string' && id.startsWith('sim-busy-')
}

export function busyRosterFor({ now = Date.now(), enabled = false } = {}) {
  if (!enabled) return []
  const time = Number(now)
  const bucket = Number.isFinite(time) ? Math.floor(time / 600_000) : 0
  // Rotate which twelve of twenty are on trips without changing list order.
  const offset = seededHash(`clemson-status-${bucket}`) % ROSTER.length
  return ROSTER.map((driver, index) => {
    const status = (index + offset) % ROSTER.length < 12 ? 'on_trip' : 'unavailable'
    return { ...driver, status, statusLabel: status === 'on_trip' ? 'On a trip' : 'Unavailable' }
  })
}
