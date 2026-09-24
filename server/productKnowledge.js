const ACCOUNT_TABS = ['profile', 'notifications', 'billing', 'vehicle', 'student', 'privacy', 'help', 'support']
const ROUTES = new Set([
  'schedule', 'friends', 'carpool', 'account', 'home', 'driver',
  'driver-signup', 'driver-onboarding', 'rate', 'terms', 'privacy',
  'requested', 'tiers', 'confirm', 'pick-driver',
])

export function action(label, route, params = {}) {
  return { label, route, params }
}

export function sanitizeActions(actions) {
  const seen = new Set()
  const out = []
  for (const item of actions || []) {
    if (!item || typeof item.label !== 'string' || !ROUTES.has(item.route)) continue
    const params = {}
    if (item.params && typeof item.params === 'object') {
      if (item.route === 'account' && ACCOUNT_TABS.includes(item.params.tab)) params.tab = item.params.tab
      if (item.route === 'rate' && item.params.trip) params.trip = String(item.params.trip).slice(0, 80)
      if (item.params.dest && ['confirm', 'tiers', 'pick-driver', 'requested'].includes(item.route)) {
        params.dest = String(item.params.dest).slice(0, 120)
      }
    }
    const key = `${item.route}:${params.tab || ''}:${params.trip || ''}:${item.label}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ label: item.label.slice(0, 60), route: item.route, params })
    if (out.length === 3) break
  }
  return out
}

export const PRODUCT_BRIEF = `
Clemson RIDES is a campus and airport rideshare for Clemson, South Carolina. It is software that connects riders with independent drivers. It is not Clemson University transit and not a common carrier.

Bottom tabs: Schedule, Friends, Account, Rides (Rides opens the rider home, route "home").

Account tabs, in order: Profile, Alerts, Billing, Vehicle, Student, Privacy, Help, Support.
Help explains how the app works. Support is a different chat for bugs, billing problems, ride disputes, account issues, and safety. Help must never create a ticket.

Booking a local ride (rider):
1. Rides tab. Enter a destination or pick a shortcut.
2. Confirm pickup.
3. Choose a tier: Standard, Wait & Save, Extra Comfort, XL, Pet, or Tesla Model 3. Tesla Model 3 is the Clemson fleet option. A person still drives. There is no live self-driving dispatch and no robotaxi telemetry. The tier screen shows sample local prices and a "10% off Standard" student promo. Standard on that screen can open an upsell before Pick driver. The Tesla upsell must say a driver is at the wheel.
4. Pick driver lists approved drivers who are online, plus any drivers this rider saved. Name, rating, vehicle, and a straight-line ETA show when that data exists. The request is status "requested" and is pinned to that driver. If they decline, the trip is canceled. It does not auto-match to another driver. Airport Schedule is the open pool (status "searching").
5. Requested screen tracks the trip.
Sign-in is required to book. Guest browsing of marketing and schedule is allowed.

Weekend and party schedule (rider):
1. Schedule tab, Weekend / party.
2. Choose Airport (GSP or CLT) or Campus.
3. Set date and time at least 30 minutes ahead. Friday 9:00 PM is the starting suggestion.
4. Confirm saves a scheduled trip with purpose party_weekend. It shows under Upcoming. Drivers see it in the Weekend filter. Optional Tesla Model 3 is the same driver-operated fleet stub.

Airport schedule (rider):
1. Schedule tab, Airport deposit.
2. Choose GSP (Greenville-Spartanburg, flat $75) or CLT (Charlotte Douglas, flat $175).
3. Optional date and time.
4. Book creates a trip in status "searching" (pickup Memorial Stadium) and starts Stripe Checkout for a 25% deposit. A date keeps that hold scheduled.
Airport flat rates are not game-day surged. A verified Clemson student gets 10% off Standard, which includes these airport fares because Schedule prices them as Standard. Deposit is 25% of the fare after that discount.
Do not invent a refund window. Terms say cancel promptly and deposit refund rules follow the in-app and Stripe receipt terms.

Student discount:
10% off Standard only. Account → Student. Eligible when the account email ends with @clemson.edu, which includes @g.clemson.edu, or when student_verified_at is set. Other tiers are not discounted by this rule.

Friends / group ride:
Friends tab → Ride with friends. The organizer needs a registered vehicle. Set pickup and dropoff, create an invite link (/friends/:token). Friends join with their own stops. Capacity is the vehicle seat count and never more than 5 people total. The route is optimized and the fare is split. Confirm charges every share (saved card off-session, or the Payment Element / Apple Pay). The trip is booked only when every share is paid. Do not describe Checkout pay-links for friend rides.

Carpool:
Friends tab, Marketing, or Account → Vehicle → Offer a carpool. Same lobby as friends with kind=carpool (/carpool/:token). The organizer is the assigned driver. The trip is created as accepted and skips open driver matching. Meant for a Clemson student with a registered car.

Live location:
From Friends, after a ride exists, or from an active trip. Creates a token link (/share/:token or /live/:token). Someone with the link sees the live map. Revoking the share stops it. Do not claim location is shared with the whole campus.

Billing:
Account → Billing → Add a card. Stripe SetupIntent and Payment Element. The app stores brand and last 4 only, plus billing_activated_at. It does not store the full card number. The saved card is used for friend and carpool shares. Airport deposits use Stripe Checkout, which is separate from the saved-card form.
If no card is on file, walk the user to Account → Billing → Add a card. Do not ask for the card number in chat.

Ratings:
After a completed trip either person can rate the other once, 1–5 stars plus an optional comment. Account shows a soft reminder. The rate screen is opened as rate?trip=<id>. Skipping is allowed. Driver home sends the driver to that screen when they mark a trip completed.

Driver signup and approval:
Account → Vehicle → Driver signup. Quiz must be Yes for student, car, insurance, and wanting to drive fellow students, plus an insurance attestation. Then make, model, and plate. There is no license-upload step in the app. On success the server sets role driver, writes driver_applications with status approved, saves the vehicle, and sets driver_status offline. A @clemson.edu email is soft-verified. An older Driver onboarding screen still exists at driver-onboarding, but the Account button opens driver-signup.
If application status is anything other than approved, or there is no vehicle, send them through Driver signup. Do not invent extra document requirements or an admin email review that the app does not show.
Payout timing and platform fees are not published in the product. Terms say they are disclosed in driver onboarding or Account. Do not invent a payday.

Driver home:
Account → Vehicle → Switch to driver mode (route driver). Opening it marks the driver online and publishes location when the browser allows. The map can show a heat layer. Windows: Now, Weekday morning, Friday night, Last 7 days. Map types: Roadmap, Satellite, Hybrid. Heat mixes typical Clemson downtown and campus patterns with live trip demand when the database has it. It is not an Uber or Lyft feed.
Open trips in searching or offered can be accepted. Then the driver advances accepted → arriving → in progress → completed. Earnings on that screen are the sum of completed fare amounts, not a payout.

Profile, alerts, privacy:
Profile: name, bio, music, favorite campus spots, ride style, avatar, gallery.
Alerts: Ride updates, Billing and receipts, Friends / carpool, Promotions (off by default), System.
Privacy: Public, Matched rides, or Private.

Support contact if someone needs a person: Account → Support, or email rides@clemson.edu. Help does not file that request.
`.trim()

export const TOPICS = [
  {
    id: 'book-local',
    roles: ['rider'],
    keywords: ['book', 'where to', 'destination', 'tier', 'standard', 'wait', 'comfort', 'xl', 'tesla', 'pick driver', 'pickup'],
    title: 'Book a ride',
    steps: [
      'Open the Rides tab.',
      'Enter where you are headed, or tap a shortcut.',
      'Confirm the pickup.',
      'Choose a tier. Student pricing is 10% off Standard only.',
      'Pick an online driver. That request stays with them. If they decline, it is canceled and does not auto-match.',
      'Watch the trip on Requested.',
    ],
    actions: [action('Open Rides', 'home'), action('Confirm pickup', 'confirm')],
  },
  {
    id: 'airport',
    roles: ['rider'],
    keywords: ['schedule', 'airport', 'gsp', 'clt', 'deposit', 'flat', 'charlotte', 'greenville'],
    title: 'Schedule an airport ride',
    steps: [
      'Open the Schedule tab.',
      'Choose GSP ($75 flat) or CLT ($175 flat).',
      'Add a date and time if you have them.',
      'Book. A signed-in rider gets a searching trip and Stripe Checkout for the 25% deposit.',
      'A @clemson.edu student gets 10% off that Standard fare before the deposit is calculated.',
    ],
    actions: [action('Open Schedule', 'schedule')],
  },
  {
    id: 'friends',
    roles: ['rider', 'driver'],
    keywords: ['friend', 'friends', 'split', 'invite', 'group'],
    title: 'Ride with friends',
    steps: [
      'Open the Friends tab and start Ride with friends.',
      'The organizer needs a vehicle on file. Add one under Account → Vehicle → Driver signup if it is missing.',
      'Set your pickup and dropoff, then create the invite link.',
      'Friends join with their own stops. The party max is your seat count, and never more than 5.',
      'Review the split, then confirm. Everyone is charged (saved card or Payment Element) before the trip books.',
    ],
    actions: [action('Open Friends', 'friends')],
  },
  {
    id: 'carpool',
    roles: ['rider', 'driver'],
    keywords: ['carpool'],
    title: 'Offer a carpool',
    steps: [
      'Open Friends, or Account → Vehicle → Offer a carpool.',
      'You need a registered vehicle. You are the driver.',
      'Set your start and end and share the /carpool link.',
      'Riders join with their own stops. The fare splits automatically.',
      'Confirm charges everyone. When all shares are paid, one trip is booked with you assigned.',
    ],
    actions: [action('Offer a carpool', 'carpool'), action('Vehicle tab', 'account', { tab: 'vehicle' })],
  },
  {
    id: 'live',
    roles: ['rider', 'driver'],
    keywords: ['live location', 'share location', 'share my location', 'tracking', 'live share'],
    title: 'Share live location',
    steps: [
      'Start or join a ride first.',
      'Open the Friends tab and share live location for the active trip.',
      'Send the private /share or /live link only to people who should see you.',
      'Revoke the share when you want the map to stop updating.',
    ],
    actions: [action('Open Friends', 'friends')],
  },
  {
    id: 'billing',
    roles: ['rider', 'driver'],
    keywords: ['card', 'billing', 'payment', 'add a card', 'stripe', 'pay'],
    title: 'Add a card',
    steps: [
      'Open Account → Billing.',
      'Tap Add a card.',
      'Complete the Stripe form. Clemson RIDES stores the brand and last 4, not the full number.',
      'Airport deposits still go through Stripe Checkout from Schedule. Friend and carpool charges use the saved card when it is on file.',
    ],
    actions: [action('Open Billing', 'account', { tab: 'billing' })],
  },
  {
    id: 'student',
    roles: ['rider', 'driver'],
    keywords: ['student', 'clemson.edu', 'discount', 'verified', 'g.clemson'],
    title: 'Student discount',
    steps: [
      'Open Account → Student.',
      'The discount is 10% off Standard fares, including GSP and CLT airport rates.',
      'It applies when your email ends with @clemson.edu (that includes @g.clemson.edu) or student_verified_at is set.',
      'Comfort, XL, Pet, and Tesla prices are not covered by this discount.',
    ],
    actions: [action('Open Student', 'account', { tab: 'student' })],
  },
  {
    id: 'ratings',
    roles: ['rider', 'driver'],
    keywords: ['rate', 'rating', 'stars', 'review'],
    title: 'Rate a trip',
    steps: [
      'When a trip is completed, Account can show a reminder.',
      'Open Rate and choose 1 to 5 stars. A comment is optional.',
      'You can rate the other person once. You can also skip.',
    ],
    actions: [action('Open Account', 'account', { tab: 'profile' })],
  },
  {
    id: 'alerts',
    roles: ['rider', 'driver'],
    keywords: ['alert', 'notification', 'notifications'],
    title: 'Notification alerts',
    steps: [
      'Open Account → Alerts.',
      'Toggle Ride updates, Billing and receipts, Friends / carpool, Promotions, or System.',
      'Promotions start off. The others start on.',
    ],
    actions: [action('Open Alerts', 'account', { tab: 'notifications' })],
  },
  {
    id: 'privacy',
    roles: ['rider', 'driver'],
    keywords: ['privacy', 'gallery', 'who can see', 'private'],
    title: 'Privacy',
    steps: [
      'Open Account → Privacy.',
      'Choose Public, Matched rides, or Private.',
      'Private shows name and rating. Matched rides hides bio, spots, and gallery until you share a trip.',
      'Save privacy.',
    ],
    actions: [action('Open Privacy', 'account', { tab: 'privacy' })],
  },
  {
    id: 'profile',
    roles: ['rider', 'driver'],
    keywords: ['profile', 'avatar', 'bio', 'music', 'photo'],
    title: 'Edit your profile',
    steps: [
      'Open Account → Profile.',
      'Update your name, bio, music, campus spots, and ride style.',
      'Tap the avatar to upload a photo, or add a gallery image.',
      'Save profile.',
    ],
    actions: [action('Open Profile', 'account', { tab: 'profile' })],
  },
  {
    id: 'driver-signup',
    roles: ['driver'],
    keywords: ['signup', 'sign up', 'onboarding', 'application', 'approved', 'approval', 'insurance', 'vehicle', 'plate', 'become a driver'],
    title: 'Driver signup',
    steps: [
      'Open Account → Vehicle → Driver signup.',
      'Answer Yes to student, car, insurance, and driving for extra money, and accept the attestation.',
      'Enter make, model, and plate.',
      'When that quiz succeeds, the application is marked approved and your role becomes driver. The app does not ask for a license upload.',
      'A @clemson.edu email is marked student-verified at the same time.',
    ],
    actions: [action('Driver signup', 'driver-signup'), action('Vehicle tab', 'account', { tab: 'vehicle' })],
  },
  {
    id: 'driver-online',
    roles: ['driver'],
    keywords: ['online', 'go online', 'accept', 'offer', 'arriving', 'earnings', 'driver mode', 'payout'],
    title: 'Drive',
    steps: [
      'Open Account → Vehicle → Switch to driver mode.',
      'The driver map comes online and can share your location.',
      'Accept an open offer, then move it from arriving to in progress to completed.',
      'Earnings on that screen add up completed fares. The app does not publish a payout calendar.',
    ],
    actions: [action('Driver mode', 'driver'), action('Vehicle tab', 'account', { tab: 'vehicle' })],
  },
  {
    id: 'heat',
    roles: ['driver'],
    keywords: ['heat', 'heatmap', 'heat map', 'satellite', 'hybrid', 'roadmap', 'map type', 'surge'],
    title: 'Heat map and map type',
    steps: [
      'On the driver map, turn the heat layer on.',
      'Switch the window: Now, Weekday morning, Friday night, or Last 7 days.',
      'Change the map type among Roadmap, Satellite, and Hybrid.',
      'Heat is typical Clemson demand plus live trip points when they exist. It is not a commercial rideshare map.',
    ],
    actions: [action('Driver mode', 'driver')],
  },
]

export function bestTopic(role, text) {
  const q = String(text || '').toLowerCase()
  let best = null
  let score = 0
  for (const topic of TOPICS) {
    if (!topic.roles.includes(role)) continue
    let next = 0
    for (const keyword of topic.keywords) {
      if (q.includes(keyword)) next += keyword.length > 6 ? 2 : 1
    }
    if (next > score) {
      score = next
      best = topic
    }
  }
  return score > 0 ? best : null
}
