/**
 * Why Clemson Rides sections. One row is one feature.
 *
 * PROD GATE: these claims depend on the messaging, scheduled-boost, and
 * backup-queue pull requests being in the production release. See
 * DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS in differentiators.js.
 * Do not publish this copy on production while that flag is true.
 *
 * "Only at Clemson Rides" is only for the backup driver and the
 * confirm-before-pickup rule. Do not name other ride companies here.
 */
import { BACKUP_BONUS_PRESETS_CENTS, BACKUP_CONFIRM_WINDOW_MS } from '../../shared/backupDriverQueue.js'
import { BOOST_DRIVER_SHARE_BPS, BOOST_MAX_CENTS, BOOST_PRESETS_CENTS, formatBoostDollars } from '../../shared/scheduledBoost.js'
import { MESSAGING_LOST_ITEM_DAYS } from '../../shared/copy/messaging.js'
import { TIGER_PASS_DISCOUNT_PCT, TIGER_PASS_NAME, TIGER_PASS_PRICE_CENTS } from '../../shared/tigerPass.js'
import { BONUS_CAP_CENTS } from '../../packages/rides-native/tigerHeat.js'
import { SCHEDULE_AHEAD_DISCOUNT_PCT } from '../../shared/rideOptions.js'
import { CARPOOL_DISCOUNT_BPS, STUDENT_DISCOUNT_BPS } from '../lib/fareRates.js'
import { MIN_LEAD_MS } from '../lib/scheduledRideModel.js'
import { DESTINATIONS } from '../store.js'

export const ONLY_AT_CLEMSON_RIDES = 'Only at Clemson Rides'

export const FEATURES_HEADING = 'Peace of mind, built in'

export const CONFIRM_LEAD_MINUTES = BACKUP_CONFIRM_WINDOW_MS / 60000

const LEAD_MINUTES = MIN_LEAD_MS / 60000

function choiceList(centsList) {
  const amounts = centsList.map((cents) => formatBoostDollars(cents))
  if (amounts.length <= 1) return amounts[0] || ''
  if (amounts.length === 2) return `${amounts[0]} or ${amounts[1]}`
  return `${amounts.slice(0, -1).join(', ')}, or ${amounts[amounts.length - 1]}`
}

function airportFare(id) {
  const place = DESTINATIONS.find((item) => item.id === id)
  return formatBoostDollars(place?.fare || 0)
}

function driverKeepsBoost() {
  if (BOOST_DRIVER_SHARE_BPS >= 10000) return 'Your driver keeps all of it.'
  const pct = Math.round(BOOST_DRIVER_SHARE_BPS / 100)
  return `Your driver keeps ${pct}% of it.`
}

const boostChoices = choiceList(BOOST_PRESETS_CENTS)
const backupChoices = choiceList(BACKUP_BONUS_PRESETS_CENTS)
const boostCap = formatBoostDollars(BOOST_MAX_CENTS)
const studentPercent = STUDENT_DISCOUNT_BPS / 100
const carpoolPercent = CARPOOL_DISCOUNT_BPS / 100
const passPrice = formatBoostDollars(TIGER_PASS_PRICE_CENTS)
const heatCap = formatBoostDollars(BONUS_CAP_CENTS)
const gspFare = airportFare('gsp')
const cltFare = airportFare('clt')

export const FEATURES = [
  {
    id: 'backup-driver',
    title: 'Guaranteed pickup',
    exclusive: true,
    what: `Add a second driver for ${backupChoices} on a scheduled ride. If the first driver cannot make it, the backup takes the trip.`,
    steps: [
      'Schedule the ride.',
      `Add a backup driver for ${backupChoices}.`,
      'That amount is a hold on your card with the fare. You are charged when the trip ends.',
      'The second driver is paid for being ready, even if they never have to drive.',
      'If the first driver cannot make it, the backup takes the trip.',
    ],
    why: 'You still have a way to the airport if the first driver cannot make it. The second driver is already in line.',
  },
  {
    id: 'confirm',
    title: 'Drivers confirm before they come',
    exclusive: true,
    what: `Your driver confirms ${CONFIRM_LEAD_MINUTES} minutes before pickup, or the backup takes over. With no backup, the ride opens to every driver.`,
    steps: [
      'A Confirm trip button appears before pickup.',
      `Your driver has ${CONFIRM_LEAD_MINUTES} minutes to tap it.`,
      'Tapping it means they will go to pickup and finish the ride.',
      'If they do not tap it, the backup takes over.',
      'With no backup, the ride opens to every driver.',
    ],
    why: 'You know someone is committed before you head to the curb. A missed confirm does not leave the ride stuck.',
  },
  {
    id: 'on-the-way',
    title: 'On-the-way alerts',
    exclusive: false,
    what: 'After they confirm, a countdown starts. When it hits zero, navigation starts and you are told to sit tight, because your driver is on the way.',
    steps: [
      'After Confirm trip, a countdown starts.',
      'Leave now is the pickup time minus the drive.',
      'When it hits zero, the route to pickup starts on the map.',
      'The driver can also open that route in Apple Maps or Google Maps.',
      'You are told to sit tight. Your driver is on the way.',
    ],
    why: 'You can wait where you are until the car is actually moving toward you.',
  },
  {
    id: 'switch-cancel',
    title: 'Switch or cancel, your call',
    exclusive: false,
    what: `You can switch once before your driver starts toward you, or cancel. The first driver gets the ${backupChoices}, a switch never counts against them, and a cancel pays that fee to the first driver only.`,
    steps: [
      'You can switch once, before your driver starts toward you.',
      'The two drivers swap places. The second driver becomes your driver.',
      `The first driver gets the ${backupChoices}. A switch never counts against them.`,
      'Your new driver gets the fare and any boost.',
      'If you cancel, the first driver gets that fee, the second driver does not, and any boost is given back.',
    ],
    why: 'You can change the plan. A driver who was ready is paid, and a switch does not count against them.',
  },
  {
    id: 'boosts',
    title: 'Boost your scheduled ride',
    exclusive: false,
    what: `Add ${boostChoices}, or your own amount, on a scheduled ride. ${driverKeepsBoost()}`,
    steps: [
      `Pick ${boostChoices}, or type your own amount, up to ${boostCap}.`,
      driverKeepsBoost(),
      'The boost is part of the hold on your card. You are charged when the ride ends.',
      'You can raise the boost until a driver accepts.',
      'If you cancel, the boost is given back.',
    ],
    why: 'A little extra can get a driver to take a scheduled ride sooner. That extra goes to the driver.',
  },
  {
    id: 'messaging',
    title: 'Message your driver',
    exclusive: false,
    what: 'You can message after a driver accepts, and during the ride. After the ride, chat opens again only for a lost item.',
    steps: [
      'Chat opens after a driver accepts.',
      'You can message during the ride.',
      'Chat closes when the ride ends.',
      'A lost item is the only way to open it again.',
      `The driver reports it with Report a lost item. Chat stays open for ${MESSAGING_LOST_ITEM_DAYS} days, or until it is marked resolved.`,
    ],
    why: 'You can reach the driver while the ride is happening. A lost item does not leave you without a way to write them.',
  },
  {
    id: 'carpool',
    title: 'Carpool',
    exclusive: false,
    what: `Carpool is ${carpoolPercent}% off Standard, for 1 or 2 seats. It does not pair you with other riders.`,
    steps: [
      'Choose Carpool when you book.',
      'Pick 1 or 2 seats.',
      `Each seat is ${carpoolPercent}% off Standard.`,
      'A driver is matched the same way as a Standard ride.',
      'Two carpool requests are not combined into one car.',
    ],
    why: 'The seat costs less than the full fare. You still book it like a normal ride.',
  },
  {
    id: 'tiger-pass',
    title: TIGER_PASS_NAME,
    exclusive: false,
    what: `${TIGER_PASS_NAME} is ${passPrice} a month and takes ${TIGER_PASS_DISCOUNT_PCT}% off Standard, Wait & Save, Extra Comfort, and Carpool. Drivers you save can be offered first.`,
    steps: [
      `Subscribe for ${passPrice} a month.`,
      `An active pass takes ${TIGER_PASS_DISCOUNT_PCT}% off Standard, Wait & Save, Extra Comfort, and Carpool.`,
      'The discount comes after the student price, and before schedule-ahead.',
      'Drivers you save can be offered before the open pool.',
      'Map preview cars are not favorites.',
    ],
    why: 'Repeat rides cost less. A driver you already saved can see the request first.',
  },
  {
    id: 'tiger-heat',
    title: 'Tiger Heat',
    exclusive: false,
    what: 'Busy pickup areas pay drivers extra. This is driver pay, not a lower fare for you.',
    steps: [
      'Zones come from real pickup demand.',
      `More pickups in a zone pay the driver more, up to ${heatCap}.`,
      'A map preview of a zone does not reserve that pay.',
      'Longer trips can add a duration bonus. Game day can pay more per minute, still inside the cap.',
      'The bonus goes to the driver. It does not lower your fare.',
    ],
    why: 'Drivers can see where pickups are busy, so cars are more likely to be nearby. Your fare is a separate price.',
  },
  {
    id: 'women-only',
    title: 'Women-only',
    exclusive: false,
    what: 'If you identify as a woman, you can ask for a woman driver. Matching then skips drivers who do not match.',
    steps: [
      'Turn it on only if you identify as a woman.',
      'Set it before a driver is assigned.',
      'Matching then skips drivers who do not match.',
      'If that check is unavailable, rides are not hidden.',
    ],
    why: 'You can ask for that match before the request goes out.',
  },
  {
    id: 'safety',
    title: 'Safety on the ride',
    exclusive: false,
    what: 'You can record on your phone during the ride. The clip stays on the phone, and you can share the trip or use SOS.',
    steps: [
      'After a driver accepts, you can start a recording on your phone.',
      'The clip stays on the phone and is never uploaded.',
      'A banner stays up while it is recording.',
      'You can send a live trip link to someone you trust.',
      'SOS can call 911 or Clemson Police, or send an in-app alert. The first press confirms and does not dial.',
    ],
    why: 'The ride stays on your phone. Help is one confirmed tap away.',
  },
  {
    id: 'favorites',
    title: 'Favorite drivers',
    exclusive: false,
    what: 'Save a driver from Pick a driver. Saved drivers are offered before the open pool.',
    steps: [
      'Open Pick a driver.',
      'Save a driver you want offered again.',
      'Saved drivers are offered before the open pool.',
      `${TIGER_PASS_NAME} can offer preferred drivers in that saved set first.`,
      'Map preview cars cannot be saved, and they are not used for matching.',
    ],
    why: 'A driver you already know can see the request before the open pool.',
  },
  {
    id: 'clemson',
    title: 'Built for Clemson',
    exclusive: false,
    what: 'This is a student ride product for this campus, not an official Clemson University service. Pickups are campus places, plus scheduled airport rides.',
    steps: [
      'Booking uses campus pickup spots.',
      'A confirmed Clemson email can unlock the student price on Standard.',
      'Game day shows the pickup zone and the fare from the server.',
      `Scheduled airport rides go to Greenville-Spartanburg (GSP) and Charlotte Douglas (CLT).`,
    ],
    why: 'The trips are the ones around this campus. Clemson RIDES is not an official Clemson University service.',
  },
  {
    id: 'airports',
    title: 'Airport rides',
    exclusive: false,
    what: `Schedule a ride to Greenville-Spartanburg (GSP) for ${gspFare} or Charlotte Douglas (CLT) for ${cltFare}.`,
    steps: [
      'Open Schedule.',
      `Choose GSP (${gspFare}) or CLT (${cltFare}).`,
      `Set a date and time at least ${LEAD_MINUTES} minutes ahead.`,
      `A pickup that far ahead is ${SCHEDULE_AHEAD_DISCOUNT_PCT}% off the server fare.`,
      'You can add a backup driver and a boost on that ride.',
    ],
    why: 'The airport ride is set before you leave campus. A backup can be in line if you want one.',
  },
  {
    id: 'student',
    title: 'Student price',
    exclusive: false,
    what: `A confirmed @clemson.edu or @g.clemson.edu email gets ${studentPercent}% off Standard, including airport flats. That discount does not include Carpool.`,
    steps: [
      'Sign in with a confirmed @clemson.edu or @g.clemson.edu email.',
      `That email gets ${studentPercent}% off Standard.`,
      'The discount includes airport flats on Standard.',
      'It does not include Carpool.',
      'Any other email stays at full price.',
    ],
    why: 'A Clemson address lowers the Standard fare. You see that price before you book.',
  },
  {
    id: 'game-day',
    title: 'Game day',
    exclusive: false,
    what: 'When a game day is live, the home screen shows the pickup zone and the fare. You can also schedule a game-day ride.',
    steps: [
      'When a game day is live, the home screen shows the pickup zone.',
      'The fare on that screen comes from the server.',
      'You can schedule a game-day ride ahead of time.',
      'Drivers can filter their queue to game day trips.',
    ],
    why: 'You know where to meet, and what the fare is, before you leave for the stadium.',
  },
  {
    id: 'weekend',
    title: 'Weekend and party',
    exclusive: false,
    what: 'You can schedule a Friday or Saturday night ride. Drivers see those as weekend and party pickups.',
    steps: [
      'Open Schedule.',
      'Pick Friday night or Saturday night.',
      'Confirm the time.',
      'Drivers see that ride under weekend and party.',
    ],
    why: 'A night out can be booked ahead, so you are not looking for a ride at the curb.',
  },
]

export function featureAnchor(id) {
  return `feature-${id}`
}
