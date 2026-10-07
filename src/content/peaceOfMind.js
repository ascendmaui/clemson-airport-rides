/**
 * Homepage feature copy. Live items match staging code.
 * status "soon" is for branches that are not merged into staging/tf24-integration.
 */
import { BOOST_SCHEDULE_NOTE, boostHowItWorks } from '../../shared/copy/boost.js'

const boostGuide = boostHowItWorks()

export const BUILT_IN_SECTION = {
  kicker: 'Peace of mind',
  title: 'Peace of mind, built in',
}

export const BUILT_IN = [
  {
    id: 'backup-driver',
    status: 'soon',
    imageId: null,
    title: 'Backup driver',
    what: 'A second driver kept ready if the first driver cannot take the trip.',
    how: 'Not on staging yet.',
    why: 'It stays marked Coming soon until the backup queue is merged.',
  },
  {
    id: 'driver-confirm',
    status: 'soon',
    imageId: null,
    title: 'Driver confirm',
    what: 'The assigned driver confirms the pickup before heading out.',
    how: 'Not on staging yet. On staging, a driver can accept a scheduled ride, and the trip screen then says your driver is on the way.',
    why: 'The confirm-before-heading step is still on a branch that has not merged.',
  },
  {
    id: 'on-the-way',
    status: 'live',
    imageId: null,
    title: 'On-the-way alerts',
    what: 'The trip screen tells you when a driver is heading to pickup.',
    how: 'After they accept, the title is “Your driver is on the way.” The line under it says they accepted and are heading to pickup.',
    why: 'You know the driver is moving toward you.',
  },
  {
    id: 'switch-cancel',
    status: 'soon',
    imageId: null,
    title: 'Switch or cancel',
    what: 'Switch to the backup driver, or cancel that plan.',
    how: 'Not on staging yet.',
    why: 'It stays marked Coming soon until that backup switch is merged.',
  },
  {
    id: 'boosts',
    status: 'live',
    imageId: null,
    title: 'Boosts',
    what: boostGuide.intro,
    how: `${boostGuide.steps.join(' ')} ${BOOST_SCHEDULE_NOTE}`,
    why: 'A scheduled ride can include extra money so a driver wants to take it.',
  },
  {
    id: 'messaging',
    status: 'live',
    imageId: null,
    title: 'Messaging and lost items',
    what: 'Chat with your driver, and keep that chat open for a lost item.',
    how: '',
    why: 'You can reach the driver during the ride, and a lost item can reopen that chat.',
  },
  {
    id: 'carpool',
    status: 'live',
    imageId: null,
    title: 'Carpool',
    what: 'Book a carpool is a ride type: 15% off, for 1 or 2 seats.',
    how: 'It is dispatched like a Standard ride. Two separate carpool requests are not combined into one car. You can also open the carpool hub and fill a car with friends. Stranger matching there caps the car at 4 riders. Each person pays a share of their own solo price: two riders pay 55%, three pay 42%, and four pay 35%. Friends can split evenly or by distance.',
    why: 'The booked seat costs less than the full fare, and a friends carpool can still share one car.',
  },
  {
    id: 'tiger-pass',
    status: 'live',
    imageId: null,
    title: 'Tiger Pass',
    what: 'A $9.99 monthly pass for frequent riders.',
    how: 'An active pass takes 10% off Standard, Wait & Save, Extra Comfort, and Carpool after the student discount and before schedule-ahead. Favorite drivers are offered before the open pool. With the pass on, preferred drivers in that saved set are offered first. Map preview cars are not favorites.',
    why: 'Repeat rides cost less, and drivers you already saved can see the request first.',
  },
  {
    id: 'tiger-heat',
    status: 'live',
    imageId: null,
    title: 'Tiger Heat',
    what: 'A driver pay bonus drawn from real pickup demand.',
    how: 'Zones come from pickup density in a 90-minute window. Four requests pay $10, eight pay $20, and twelve pay $30, which is the cap. A preview draws the zone and does not reserve driver pay. Trips longer than 15 minutes add a duration bonus, and game day pays more per minute, still inside the $30 cap.',
    why: 'Drivers can see where pickups are busy. It is driver pay, not a rider discount.',
  },
  {
    id: 'women-only',
    status: 'live',
    imageId: null,
    title: 'Women-only',
    what: 'A comfort preference for riders who identify as a woman.',
    how: 'You can turn it on only if you identify as a woman. Matching then skips drivers who do not match. If that database check is unavailable, the desk does not hide rides.',
    why: 'You can ask for that match before a driver is assigned.',
  },
  {
    id: 'favorite-drivers',
    status: 'live',
    imageId: null,
    title: 'Favorite drivers',
    what: 'Save drivers you want offered first.',
    how: 'Save a driver from Pick a driver. Saved drivers are offered before the open pool. With Tiger Pass, preferred drivers in that saved set are offered first.',
    why: 'A driver you already know can see the request before the open pool.',
  },
  {
    id: 'clemson-built',
    status: 'live',
    imageId: null,
    title: 'Clemson-built',
    what: 'Rides, carpools, and airport trips written around this campus.',
    how: 'Booking uses campus spots. A confirmed @clemson.edu or @g.clemson.edu email gets 10% off Standard, including the airport flats. That student discount does not include Carpool. Game day shows the pickup zone and the fare multiplier from the server. Scheduled airport rides are Greenville-Spartanburg (GSP) at $75 and Charlotte Douglas (CLT) at $175.',
    why: 'The trips, the student price, and the airports are the ones Clemson students actually use.',
  },
]

export const SAFETY_SECTION = {
  kicker: 'Nighttime safety',
  title: 'Safe nights out on College Avenue.',
  what: 'Night rides stay on your phone, from the request until you are dropped off.',
  why: 'You can see the trip, share it, and reach help without leaving the app.',
}

export const SAFETY_FEATURES = [
  {
    id: 'driver-review',
    status: 'live',
    imageId: 'safety-verified-driver',
    title: 'Driver review',
    what: 'A new driver submits an application before they can take a trip.',
    how: 'They upload a license, insurance, registration, and photos of the car, and they sign a background attestation. The attestation asks about a conviction in the last 7 years, a suspended or restricted license, and impaired driving. A yes answer is flagged for review. Authorized means they consented and disclosed nothing that needs a look. It is not a result from a screening company. Clemson RIDES approves the application. New drivers are not auto-approved.',
    why: 'You ride with someone whose application was reviewed.',
  },
  {
    id: 'live-tracking',
    status: 'live',
    imageId: 'night-live-tracking',
    title: 'Live trip tracking',
    what: 'The trip screen follows the ride on a map.',
    how: 'After a driver accepts, the map follows the ride from pickup through drop-off.',
    why: 'You can see the trip moving instead of guessing where the car is.',
  },
  {
    id: 'share-trip',
    status: 'live',
    imageId: 'safety-share-trip',
    title: 'Share your trip',
    what: 'Send a live link to someone you trust.',
    how: 'The link stays on while that trip is still going. Location updates until you revoke the share.',
    why: 'A friend can watch that ride without being in the car.',
  },
  {
    id: 'sos',
    status: 'live',
    imageId: 'night-sos',
    title: 'SOS',
    what: 'Reach 911, Clemson Police, or send an in-app alert.',
    how: 'The first press confirms and does not dial. You can then call 911 or Clemson Police, or send the in-app alert.',
    why: 'Help is one confirmed tap away during the ride.',
  },
  {
    id: 'orange-screen',
    status: 'live',
    imageId: 'night-orange-screen',
    title: 'Orange approach screen',
    what: 'The rider app flashes orange as your driver gets close.',
    how: 'After a driver has accepted, the screen shows the distance in feet and pulses orange as they get closer. It can also buzz.',
    why: 'You can spot the car when it is near, even on a busy street.',
  },
  {
    id: 'audio-recording',
    status: 'live',
    imageId: 'safety-recording',
    title: 'Voice and audio recording',
    what: 'Record the ride on your own phone.',
    how: 'Record audio during an active ride, right in the app. You start it on your phone after a driver has accepted. The clip stays on that phone and is not uploaded, and a banner stays up while it is recording.',
    why: 'You keep a recording of the ride on the phone that started it.',
  },
  {
    id: 'video-recording',
    status: 'live',
    imageId: null,
    title: 'Video recording',
    what: 'Record video on your phone during an active ride.',
    how: 'You start it after a driver has accepted. The clip stays on that phone and is not uploaded. The camera is the indicator.',
    why: 'You can save a video clip on your phone if you want one.',
  },
  {
    id: 'driver-id',
    status: 'live',
    imageId: null,
    title: 'Driver photo, car, and plate',
    what: 'See who is picking you up before you request.',
    how: 'Pick a driver shows their name, car, and plate when those are on file, plus a photo if one is saved. If there is no photo, you see their initials.',
    why: 'You can match the person and the car at the curb.',
  },
  {
    id: 'live-eta',
    status: 'live',
    imageId: 'campus-phone',
    title: 'Live ETA',
    what: 'See how long the pickup is expected to take.',
    how: 'Pick a driver shows a straight-line ETA when that driver is online. During the ride, the trip screen keeps an ETA while location updates.',
    why: 'You get a time, not only a pin on the map.',
  },
  {
    id: 'receipts',
    status: 'live',
    imageId: null,
    title: 'Trip receipts',
    what: 'A receipt for a finished trip.',
    how: 'Open the receipt for that ride. It lists the fare. Billing alerts can include receipts.',
    why: 'You can look up what the trip cost after you arrive.',
  },
  {
    id: 'emergency-contacts',
    status: 'live',
    imageId: null,
    title: 'Emergency contacts',
    what: 'People you can reach from SOS.',
    how: 'Save up to five contacts. SOS can show them when you need to reach someone.',
    why: 'The people you choose are already in the app.',
  },
]

export const CARPOOL_SECTION = {
  kicker: 'Carpool',
  title: 'Share the ride. Split the cost.',
  what: 'Book a carpool is a ride type. The fare is 15% off, for 1 or 2 seats, and it is dispatched like a Standard ride.',
  why: 'The seat costs less than the full fare. Two separate carpool requests are not combined into one car.',
  steps: [
    'Choose Book a carpool.',
    'The fare is 15% off. You can book 1 or 2 seats.',
    'A driver is matched the same way as a Standard ride.',
  ],
  hubTitle: 'Fill a car with friends',
  hubWhat: 'The carpool hub is separate. You share a link, or match riders heading the same way.',
  hubSteps: [
    'Open the carpool hub.',
    'Get matched with other riders, or invite friends. Share a link to fill the car yourself.',
    'Each person is picked up at their own stop. Stranger matching caps the car at 4 riders.',
    'You pay your share of your own solo price. Two riders pay 55% of that solo price. Three pay 42%. Four pay 35%. Friends can split evenly or by distance.',
  ],
  diagramCaption: 'One car. Three pickups. Then the airport.',
}

export const AIRPORT_SECTION = {
  kicker: 'Airport',
  title: 'Make your flight. Every time.',
  what: 'Schedule an airport ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT) before you leave.',
  why: 'The pickup is on the calendar, and the trip screen tells you when a driver accepts.',
  steps: [
    'Open Schedule and choose GSP ($75) or CLT ($175). Set a date and time at least 30 minutes ahead.',
    'A pickup that far ahead is 10% off the server fare. Nothing is charged when you book. The fare is charged when the trip ends.',
    'The ride stays scheduled until it is time to match a driver.',
    'When a driver accepts, the trip screen says "Your driver is on the way."',
  ],
}

export const APP_STORE_NOTE = 'The App Store and Play Store listings are not live yet. Book a ride in the browser.'
