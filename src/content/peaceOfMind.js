/**
 * Homepage feature copy. Live items match staging code.
 * status "coming" is for branches that are not merged into staging/tf24-integration.
 */
import { BOOST_SCHEDULE_NOTE, boostHowItWorks } from '../../shared/copy/boost.js'
import { riderSwitchGuide } from '../../shared/copy/riderSwitch.js'
import {
  BOOKING_HELPER,
  BOOKING_STEPS,
  CANCEL_HELPER,
  SWITCH_HELPER,
} from '../../shared/copy/scheduledRides.js'

const boostGuide = boostHowItWorks()
const switchGuide = riderSwitchGuide()

export const BUILT_IN_SECTION = {
  kicker: 'Peace of mind',
  title: 'Peace of mind, built in',
}

export const BUILT_IN = [
  {
    id: 'backup-driver',
    status: 'live',
    bookRoute: 'schedule',
    imageId: null,
    title: 'Backup driver',
    what: BOOKING_HELPER,
    how: BOOKING_STEPS.join(' '),
    why: 'If the first driver does not confirm, the second driver takes the trip.',
  },
  {
    id: 'driver-confirm',
    status: 'live',
    bookRoute: 'schedule',
    imageId: null,
    title: 'Driver confirm',
    what: 'Your driver has 5 minutes to tap Confirm trip before pickup.',
    how: 'A Confirm trip button appears before pickup. They have 5 minutes to tap it. Tapping it means they will go to pickup and finish the ride. If they do not tap it, the second driver in line takes the trip. If there is no second driver, the ride opens to every driver.',
    why: 'After they confirm, a countdown tells them when to leave. When it hits zero, they start toward you.',
  },
  {
    id: 'on-the-way',
    status: 'live',
    bookRoute: 'home',
    imageId: 'campus-phone',
    title: 'On-the-way alerts',
    what: 'The trip screen tells you when a driver is heading to pickup.',
    how: 'After they accept, the title is “Your driver is on the way.” The line under it says they accepted and are heading to pickup.',
    why: 'You know the driver is moving toward you.',
  },
  {
    id: 'switch-cancel',
    status: 'live',
    bookRoute: 'home',
    imageId: null,
    title: 'Switch or cancel',
    what: switchGuide.summary[0],
    how: `${switchGuide.summary.slice(1).join(' ')} If you booked a backup driver, ${SWITCH_HELPER} ${CANCEL_HELPER}`,
    why: 'A match with no backup can be canceled for free before the driver arrives. A backup booking uses the $10 or $15 fee.',
  },
  {
    id: 'boosts',
    status: 'live',
    bookRoute: 'schedule',
    imageId: null,
    title: 'Boosts',
    what: boostGuide.intro,
    how: `${boostGuide.steps.join(' ')} ${BOOST_SCHEDULE_NOTE}`,
    why: 'A scheduled ride can include extra money so a driver wants to take it.',
  },
  {
    id: 'messaging',
    status: 'live',
    bookRoute: 'home',
    imageId: null,
    title: 'Messaging and lost items',
    what: 'Message your driver after they accept, and during the ride. After the ride, chat opens again only for a lost item.',
    how: '',
    why: 'You can reach the driver during the ride, and a lost item can reopen that chat.',
  },
  {
    id: 'carpool',
    status: 'live',
    bookRoute: 'carpool',
    imageId: null,
    title: 'Carpool',
    what: 'Carpool is a discounted seat. The fare is 15% off, for 1 or 2 seats.',
    how: 'You choose Carpool. A driver is matched the same way as a Standard ride. Two separate carpool requests are not combined into one car. It does not pair you with other riders.',
    why: 'The seat costs less than the full fare.',
  },
  {
    id: 'tiger-pass',
    status: 'live',
    bookRoute: 'home',
    imageId: null,
    title: 'Tiger Pass',
    what: 'A $9.99 monthly pass for frequent riders.',
    how: 'An active pass takes 10% off Standard, Wait & Save, Extra Comfort, and Carpool after the student discount and before schedule-ahead. Favorite drivers are offered before the open pool. With the pass on, preferred drivers in that saved set are offered first. Map preview cars are not favorites.',
    why: 'Repeat rides cost less, and drivers you already saved can see the request first.',
  },
  {
    id: 'tiger-heat',
    status: 'live',
    bookRoute: 'home',
    imageId: null,
    title: 'Tiger Heat',
    what: 'A driver pay bonus drawn from real pickup demand.',
    how: 'Zones come from pickup density in a 90-minute window. Four requests pay $10, eight pay $20, and twelve pay $30, which is the cap. A preview draws the zone and does not reserve driver pay. Trips longer than 15 minutes add a duration bonus, and game day pays more per minute, still inside the $30 cap.',
    why: 'Drivers can see where pickups are busy. It is driver pay, not a rider discount.',
  },
  {
    id: 'women-only',
    status: 'live',
    bookRoute: 'home',
    imageId: null,
    title: 'Women-only',
    what: 'A comfort preference for riders who identify as a woman.',
    how: 'You can turn it on only if you identify as a woman. Matching then skips drivers who do not match. If that database check is unavailable, the desk does not hide rides.',
    why: 'You can ask for that match before a driver is assigned.',
  },
  {
    id: 'favorite-drivers',
    status: 'live',
    bookRoute: 'home',
    imageId: null,
    title: 'Favorite drivers',
    what: 'Save drivers you want offered first.',
    how: 'Save a driver from Pick a driver. Saved drivers are offered before the open pool. With Tiger Pass, preferred drivers in that saved set are offered first.',
    why: 'A driver you already know can see the request before the open pool.',
  },
  {
    id: 'clemson-built',
    status: 'live',
    bookRoute: 'home',
    imageId: 'library-study-group',
    title: 'Clemson-built',
    what: 'Rides, carpools, and airport trips written around this campus.',
    how: 'Booking uses campus spots. A confirmed @clemson.edu or @g.clemson.edu email gets 10% off Standard, including the airport flats. That student discount does not include Carpool. Game day shows the pickup zone and the fare multiplier from the server. Scheduled airport rides are Greenville-Spartanburg (GSP) at $75 and Charlotte Douglas (CLT) at $175.',
    why: 'The trips, the student price, and the airports are the ones Clemson students actually use.',
  },
]

export const SAFETY_SECTION = {
  kicker: 'Nighttime safety',
  title: 'Safe nights out',
  what: 'Night rides stay on your phone, from the request until you are dropped off.',
  why: 'You can see the trip, share it, and reach help without leaving the app.',
}

export const SAFETY_FEATURES = [
  {
    id: 'screened-drivers',
    status: 'live',
    imageId: null,
    title: 'Screened drivers',
    what: 'A new driver signs a background attestation before they can take a trip.',
    how: 'They answer three questions. One asks about a felony or misdemeanor conviction in the last 7 years, other than a minor traffic violation. One asks if their license is suspended, revoked, expired, or restricted. One asks about a driving-under-the-influence conviction in the last 7 years. A yes answer is flagged for review. Authorized means they consented and disclosed nothing that needs a look. No screening vendor has reported a result. It is not a completed background check. New drivers are not auto-approved.',
    why: 'You ride with someone whose application was reviewed.',
  },
  {
    id: 'audio-recording',
    status: 'live',
    imageId: 'safety-recording',
    title: 'Voice and audio recording',
    what: 'Record audio on this phone during an active ride.',
    how: 'The rider starts it, only after a driver accepts. The clip stays on the phone and is never uploaded. A banner stays up while it is recording. The banner reads "Audio recording is on" or "Video recording is on".',
    why: 'The clip stays on the phone that started it.',
  },
  {
    id: 'live-tracking',
    status: 'live',
    imageId: 'night-live-tracking',
    title: 'Live tracking',
    what: 'The trip screen follows the ride on a map.',
    how: 'After a driver accepts, the map follows the ride from pickup through drop-off.',
    why: 'You can see the trip moving instead of guessing where the car is.',
  },
  {
    id: 'share-trip',
    status: 'live',
    imageId: 'safety-share-trip',
    title: 'Share your ride',
    what: 'Send a live link to someone you trust.',
    how: 'The link stays on while that trip is still going. Location updates until you revoke the share.',
    why: 'A friend can watch that ride without being in the car.',
  },
  {
    id: 'sos',
    status: 'live',
    imageId: 'night-sos',
    title: 'SOS',
    what: 'Call 911 or Clemson Police, or send an in-app alert.',
    how: 'The first press confirms and does not dial. You can then call 911 or Clemson Police, or send the in-app alert.',
    why: 'Help is one confirmed tap away during the ride.',
  },
  {
    id: 'orange-screen',
    status: 'live',
    imageId: 'night-orange-screen',
    title: 'Blinking orange screen',
    what: 'The rider app flashes orange as your driver gets close.',
    how: 'After a driver has accepted, the screen shows the distance in feet and pulses orange as they get closer. It can also buzz.',
    why: 'You can spot the car when it is near, even on a busy street.',
  },
  {
    id: 'driver-id',
    status: 'live',
    imageId: 'safety-verified-driver',
    title: 'Driver photo, car, and plate',
    what: 'See who is picking you up before you request.',
    how: 'Pick a driver shows their name, car, and plate when those are on file, plus a photo if one is saved. If there is no photo, you see their initials.',
    why: 'You can match the person and the car at the curb.',
  },
  {
    id: 'women-only-night',
    status: 'live',
    imageId: null,
    title: 'Women-only rides',
    what: 'A comfort preference for riders who identify as a woman.',
    how: 'You can turn it on only if you identify as a woman. Matching then skips drivers who do not match. If that database check is unavailable, the desk does not hide rides.',
    why: 'You can ask for that match before a driver is assigned.',
  },
  {
    id: 'favorite-drivers-night',
    status: 'live',
    imageId: null,
    title: 'Favorite drivers',
    what: 'Save drivers you want offered first.',
    how: 'Save a driver from Pick a driver. Saved drivers are offered before the open pool.',
    why: 'A driver you already know can see the request before the open pool.',
  },
  {
    id: 'messaging-safety',
    status: 'live',
    imageId: null,
    title: 'Messaging',
    what: 'Chat with your driver during the ride.',
    how: '',
    why: 'You can reach the driver without leaving the trip.',
  },
  {
    id: 'live-eta',
    status: 'live',
    imageId: null,
    title: 'Live arrival times',
    what: 'See how long the pickup is expected to take.',
    how: 'Pick a driver shows a straight-line ETA when that driver is online. During the ride, the trip screen keeps an ETA while location updates.',
    why: 'You get a time, not only a pin on the map.',
  },
]

export const CARPOOL_SECTION = {
  kicker: 'Carpool',
  title: 'A discounted seat.',
  what: 'Carpool v1 is a discounted seat. It is 15% off, for 1 or 2 seats. It does not pair you with other riders.',
  why: 'The seat costs less than the full fare. Two separate carpool requests are not combined into one car.',
  steps: [
    {
      title: 'Choose Carpool',
      body: 'Carpool is a discounted seat. The fare is 15% off, for 1 or 2 seats.',
    },
    {
      title: 'Get picked up at your stop',
      body: 'A driver is matched the same way as a Standard ride. You are not paired with another rider.',
    },
    {
      title: 'Pay your share',
      body: 'You pay the Carpool price for your seat. This does not split a fare with strangers.',
    },
  ],
  diagramCaption: 'One car. Your stop. Then the ride.',
}

export const AIRPORT_SECTION = {
  kicker: 'Airport',
  title: 'Make your flight. Every time.',
  what: 'Schedule an airport ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT) before you leave.',
  why: 'The pickup is on the calendar. You are charged when the ride ends.',
  points: [
    {
      id: 'schedule-ahead',
      status: 'live',
      title: 'Schedule ahead',
      body: 'Open Schedule and choose GSP ($75) or CLT ($175). Set a date and time at least 30 minutes ahead. A pickup that far ahead is 10% off the server fare.',
    },
    {
      id: 'book-driver',
      status: 'live',
      title: 'Book a driver',
      body: 'Nothing is charged when you book. A hold can be placed before pickup. You are charged when the ride ends.',
    },
    {
      id: 'backup',
      status: 'live',
      title: 'Add a backup driver',
      body: BOOKING_HELPER,
    },
    {
      id: 'confirm',
      status: 'live',
      title: 'Driver confirms',
      body: 'Your driver has 5 minutes to tap Confirm trip before pickup. If they do not, the second driver in line takes the trip.',
    },
    {
      id: 'on-the-way',
      status: 'live',
      title: 'On-the-way alert',
      body: 'When a driver accepts, the trip screen says "Your driver is on the way."',
    },
  ],
}

export const APP_STORE_NOTE = 'The App Store and Play Store listings are not live yet. Book a ride in the browser.'
