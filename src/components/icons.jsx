/**
 * Clemson RIDES icon set — orange #F56600 + purple #522D80, rounded Lyft-style.
 */
const ORANGE = '#F56600'
const PURPLE = '#522D80'

function Svg({ size = 22, children, title, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : 'presentation'}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function IconMap({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Map" {...p}>
      <path
        d="M9.5 3.8 4.2 5.7a1.2 1.2 0 0 0-.8 1.13v11.4c0 .9.86 1.5 1.7 1.18l4.9-1.9 5.3 2.02 5.3-1.9a1.2 1.2 0 0 0:.8-1.13V4.1c0-.9-.86-1.5-1.7-1.18l-4.9 1.9-5.3-2.02Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.5 4v14M14.8 6v14" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconCar({ size, color = ORANGE, ...p }) {
  return (
    <Svg size={size} title="Car" {...p}>
      <path
        d="M5 14.5h14l-.7-3.2a2.4 2.4 0 0 0-2.35-1.9H8.05a2.4 2.4 0 0 0-2.35 1.9L5 14.5Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M7.2 9.4 8.1 7.3A1.6 1.6 0 0 1 9.55 6.4h4.9a1.6 1.6 0 0 1 1.45.9l.9 2.1" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="7.5" cy="15.8" r="1.35" fill={color} />
      <circle cx="16.5" cy="15.8" r="1.35" fill={color} />
      <path d="M4.5 14.5h15" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconCarpool({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Carpool" {...p}>
      <circle cx="8.2" cy="8" r="2.2" stroke={color} strokeWidth="1.7" />
      <circle cx="15.8" cy="8" r="2.2" stroke={ORANGE} strokeWidth="1.7" />
      <path d="M3.8 17.2c.5-2.4 2.4-3.7 4.4-3.7s3.9 1.3 4.4 3.7" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M11.4 17.2c.5-2.4 2.4-3.7 4.4-3.7s3.9 1.3 4.4 3.7" stroke={ORANGE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconBell({ size, color = ORANGE, ...p }) {
  return (
    <Svg size={size} title="Notifications" {...p}>
      <path
        d="M12 4.2a4.6 4.6 0 0 0-4.6 4.6v2.2c0 .7-.2 1.4-.55 2L5.8 15.2a.9.9 0 0 0 .75 1.4h11a.9.9 0 0 0 .75-1.4l-1.05-2.2c-.35-.6-.55-1.3-.55-2V8.8A4.6 4.6 0 0 0 12 4.2Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10.2 16.6a1.8 1.8 0 0 0 3.6 0" stroke={PURPLE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconCard({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Billing" {...p}>
      <rect x="3.2" y="6" width="17.6" height="12" rx="2.4" stroke={color} strokeWidth="1.7" />
      <path d="M3.2 10.2h17.6" stroke={ORANGE} strokeWidth="1.7" />
      <path d="M7 15h3.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconSettings({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Settings" {...p}>
      <circle cx="12" cy="12" r="3.1" stroke={ORANGE} strokeWidth="1.7" />
      <path
        d="M12 3.4v1.6M12 19v1.6M4.9 6.8l1.15 1.15M17.95 16.05l1.15 1.15M3.4 12h1.6M19 12h1.6M4.9 17.2l1.15-1.15M17.95 7.95l1.15-1.15"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function IconProfile({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Profile" {...p}>
      <circle cx="12" cy="9" r="3.2" stroke={color} strokeWidth="1.7" />
      <path d="M5.2 19c.9-3.2 3.2-4.8 6.8-4.8s5.9 1.6 6.8 4.8" stroke={ORANGE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconHeat({ size, color = ORANGE, ...p }) {
  return (
    <Svg size={size} title="Heat" {...p}>
      <path
        d="M12 20.2c3.4 0 5.8-2.3 5.8-5.4 0-2.4-1.3-3.9-2.9-5.3-.5-.45-.9-1.1-.9-1.8V6.2c0-.7-.7-1.2-1.35-.9A6.3 6.3 0 0 0 9.4 9.6c0 .7-.4 1.35-.9 1.8-1.6 1.4-2.9 2.9-2.9 5.4 0 3.1 2.4 5.4 5.8 5.4Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 16.6c1.15 0 2-.8 2-1.9" stroke={PURPLE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconShare({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Share" {...p}>
      <circle cx="18" cy="5.5" r="2.2" stroke={ORANGE} strokeWidth="1.7" />
      <circle cx="18" cy="18.5" r="2.2" stroke={ORANGE} strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.2" stroke={color} strokeWidth="1.7" />
      <path d="M8 11.2 15.8 6.6M8 12.8l7.8 4.6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconStar({ size, color = ORANGE, ...p }) {
  return (
    <Svg size={size} title="Star" {...p}>
      <path
        d="m12 3.6 2.2 4.6 5 .7-3.6 3.6.9 5.1L12 15.6 7.5 17.6l.9-5.1L4.8 8.9l5-.7L12 3.6Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function IconHome({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Home" {...p}>
      <path d="M4.2 11.2 12 4.4l7.8 6.8" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 10.5V19h10v-8.5" stroke={ORANGE} strokeWidth="1.7" strokeLinejoin="round" />
    </Svg>
  )
}

export function IconHelp({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Help" {...p}>
      <circle cx="12" cy="12" r="8.2" stroke={color} strokeWidth="1.7" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1.9-1.1 1.8" stroke={ORANGE} strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="1" fill={ORANGE} />
    </Svg>
  )
}

export function IconSchedule({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Schedule" {...p}>
      <rect x="4" y="5.5" width="16" height="14" rx="2.4" stroke={color} strokeWidth="1.7" />
      <path d="M8 3.8v3.2M16 3.8v3.2M4 10h16" stroke={ORANGE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconPrivacy({ size, color = PURPLE, ...p }) {
  return (
    <Svg size={size} title="Privacy" {...p}>
      <path
        d="M12 3.6 5.5 6.2v5.1c0 4 2.8 6.9 6.5 8.1 3.7-1.2 6.5-4.1 6.5-8.1V6.2L12 3.6Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.6 12.1 11.2 13.7 14.6 10.2" stroke={ORANGE} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function IconStudent({ size, color = ORANGE, ...p }) {
  return (
    <Svg size={size} title="Student" {...p}>
      <path d="M3.5 10.2 12 5.8l8.5 4.4L12 14.6 3.5 10.2Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7.2 12.2v3.4c0 .9 2.1 2.4 4.8 2.4s4.8-1.5 4.8-2.4v-3.4" stroke={PURPLE} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M20.5 10.4v5.2" stroke={PURPLE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export function IconClose({ size = 16, color = '#5B6472', ...p }) {
  return (
    <Svg size={size} title="Dismiss" {...p}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  )
}

export function IconSignOut({ size, color = ORANGE, ...p }) {
  return (
    <Svg size={size} title="Sign out" {...p}>
      <path d="M10 12h9.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="m16.2 8.5 3.5 3.5-3.5 3.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6.2V5.4A2.2 2.2 0 0 0 10.8 3.2H6A2.2 2.2 0 0 0 3.8 5.4v13.2A2.2 2.2 0 0 0 6 20.8h4.8A2.2 2.2 0 0 0 13 18.6v-.8" stroke={PURPLE} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  )
}

export const ICONS = {
  map: IconMap,
  car: IconCar,
  carpool: IconCarpool,
  bell: IconBell,
  card: IconCard,
  settings: IconSettings,
  profile: IconProfile,
  heat: IconHeat,
  share: IconShare,
  star: IconStar,
  home: IconHome,
  help: IconHelp,
  schedule: IconSchedule,
  privacy: IconPrivacy,
  student: IconStudent,
  close: IconClose,
  signOut: IconSignOut,
}
