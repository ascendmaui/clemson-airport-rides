/**
 * Small liquid-glass marks for marketing feature cards.
 * Orange and purple tiles share one highlight, border, and shadow.
 */
const SHAPES = {
  pin: (
    <>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="9" r="2.2" />
      <circle cx="16" cy="9.5" r="1.8" />
      <path d="M4.8 18.5c.6-2.6 2.4-3.9 4.2-3.9s3.6 1.3 4.2 3.9" />
      <path d="M13.2 18.5c.4-2 1.8-3.1 3.2-3.1 1.5 0 2.6 1 3.2 2.6" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.2 12.2 11 15l4.8-5.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6.2 16.2h11.6l-.9-1.8a4 4 0 0 1-.4-1.7V11a4.5 4.5 0 0 0-9 0v1.7c0 .6-.1 1.2-.4 1.7l-.9 1.8z" />
      <path d="M10 16.4a2 2 0 0 0 4 0" />
    </>
  ),
  swap: (
    <>
      <path d="M7 8h11l-3-3" />
      <path d="M17 16H6l3 3" />
    </>
  ),
  bolt: <path d="M13 3 6 13h5l-1 8 8-11h-5l0-7z" />,
  chat: (
    <>
      <path d="M5 6.5h14v8.2H9.2L5 18z" />
      <path d="M8.5 10.2h7M8.5 12.6h4.5" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 14.5h15l-.8-3.2a2 2 0 0 0-1.9-1.5H7.2a2 2 0 0 0-1.9 1.5L4.5 14.5z" />
      <path d="M7 9.8 8 7.8A1.4 1.4 0 0 1 9.3 7h5.4A1.4 1.4 0 0 1 16 7.8l1 2" />
      <circle cx="7.4" cy="15.6" r="1" />
      <circle cx="16.6" cy="15.6" r="1" />
    </>
  ),
  card: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 14.2h3.2" />
    </>
  ),
  flame: <path d="M12 3.2c.8 3.2 4.2 4.2 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.6.8-2.5 1.6-3.3 0 1.6.8 2.4 1.6 2.4 0-2.4-.8-4.2 1-7.3z" />,
  shield: (
    <>
      <path d="M12 3.4 5.6 6v4.6c0 3.6 2.4 6.2 6.4 7.4 4-1.2 6.4-3.8 6.4-7.4V6L12 3.4z" />
      <path d="M9 12.1 11.1 14.2 15.2 10" />
    </>
  ),
  star: <path d="m12 4 2 4.2 4.6.6-3.3 3.2.8 4.6L12 14.4 7.9 16.6l.8-4.6L5.4 8.8l4.6-.6L12 4z" />,
  plane: (
    <>
      <path d="M3.8 12.2 20.2 5.2l-6.2 13.2-2.2-4.6-8-1.6z" />
      <path d="M11.8 13.8 14.6 20" />
    </>
  ),
  cap: (
    <>
      <path d="M3 11 12 6.8 21 11 12 15.2 3 11z" />
      <path d="M7.2 12.6v3.2c0 .8 2 2.2 4.8 2.2s4.8-1.4 4.8-2.2v-3.2" />
    </>
  ),
  flag: (
    <>
      <path d="M6 20.5V4.5" />
      <path d="M6 5h11l-2.2 3.4L17 12H6" />
    </>
  ),
  moon: <path d="M16.5 14.2A6.2 6.2 0 1 1 9.2 5.2a5 5 0 0 0 7.3 9z" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M7 11.2a5 5 0 0 0 10 0M12 16.2V20" />
    </>
  ),
  share: (
    <>
      <circle cx="7" cy="12" r="2" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M8.8 11.1 15.1 8M8.8 12.9l6.3 3.1" />
    </>
  ),
  sos: (
    <>
      <path d="M12 4.2 3.8 18.2h16.4L12 4.2z" />
      <path d="M12 10v3.4" />
      <circle cx="12" cy="15.6" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  id: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <circle cx="9" cy="12" r="2" />
      <path d="M13 10.5h5M13 13.5h4" />
    </>
  ),
  wheel: (
    <>
      <circle cx="12" cy="12" r="7.2" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 8.2V10.4M9.2 13.6 7.4 14.8M14.8 13.6 16.6 14.8" />
    </>
  ),
}

const LOOKUP = {
  'backup-driver': ['people', 'purple'],
  'backup-pay': ['people', 'purple'],
  confirm: ['check', 'orange'],
  'driver-confirm': ['check', 'orange'],
  'on-the-way': ['bell', 'purple'],
  'live-eta': ['bell', 'purple'],
  'switch-cancel': ['swap', 'orange'],
  'switch-fee': ['swap', 'orange'],
  boosts: ['bolt', 'purple'],
  'boost-pay': ['bolt', 'purple'],
  messaging: ['chat', 'orange'],
  'messaging-safety': ['chat', 'orange'],
  carpool: ['car', 'orange'],
  'tiger-pass': ['card', 'purple'],
  'tiger-heat': ['flame', 'orange'],
  'women-only': ['shield', 'purple'],
  'women-only-night': ['shield', 'purple'],
  safety: ['shield', 'orange'],
  'screened-drivers': ['shield', 'orange'],
  'audio-recording': ['mic', 'purple'],
  'live-tracking': ['pin', 'orange'],
  'share-trip': ['share', 'purple'],
  sos: ['sos', 'orange'],
  'orange-screen': ['sos', 'orange'],
  'driver-id': ['id', 'purple'],
  favorites: ['star', 'purple'],
  'favorite-drivers': ['star', 'purple'],
  'favorite-drivers-night': ['star', 'purple'],
  clemson: ['pin', 'orange'],
  'clemson-built': ['pin', 'orange'],
  airports: ['plane', 'purple'],
  student: ['cap', 'orange'],
  'game-day': ['flag', 'purple'],
  weekend: ['moon', 'orange'],
  pin: ['pin', 'orange'],
  wheel: ['wheel', 'purple'],
}

export function GlassGlyph({ name, size = 44 }) {
  const [shape, tone] = LOOKUP[name] || LOOKUP.pin
  return (
    <span className={`mkt-glass-glyph mkt-glass-glyph--${tone}`}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {SHAPES[shape] || SHAPES.pin}
        </g>
      </svg>
    </span>
  )
}
