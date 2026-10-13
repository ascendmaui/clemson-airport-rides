/**
 * Rider-facing explanations for Standard, Wait & Save, Extra Comfort, and Carpool.
 * The sentences are the ride-types page notes.
 */
import { CARPOOL_DISCOUNT_BPS, STUDENT_DISCOUNT_BPS } from '../../src/lib/fareRates.js'
import { OFFERED_RIDE_TIERS, RIDE_OPTION_CATALOG } from '../rideOptions.js'

export const RIDE_TYPE_ORANGE = '#F56600'
export const RIDE_TYPE_PURPLE = '#522D80'

const carpoolPct = CARPOOL_DISCOUNT_BPS / 100
const studentPct = STUDENT_DISCOUNT_BPS / 100

export const RIDE_TYPE_NOTES = Object.freeze({
  standard: 'The base ride. The fare on the booking screen is the price before you confirm.',
  wait: 'Shown when a driver can serve it. The fare is the quote on that screen. The student discount does not apply.',
  comfort: 'Newer cars. Only a vehicle marked Extra Comfort can take this ride.',
  carpool: `${carpoolPct}% off the Standard fare for each seat. Book 1 or 2 seats. Drivers see it labeled Carpool, and it is offered to the same cars as Standard. Two separate carpool requests are not combined into one car.`,
})

export const RIDE_TYPE_STUDENT_NOTE = `${studentPct}% off Standard when the signed-in email is confirmed and ends with @clemson.edu or @g.clemson.edu. Other ride types are not included.`

export const RIDE_TYPE_GUIDE = Object.freeze({
  kicker: 'Ride types',
  title: 'Four ways to ride',
  infoLabel: 'Ride types',
  lede: 'The quote on the booking screen is the price before you confirm.',
  studentTitle: 'Student discount',
  studentNote: RIDE_TYPE_STUDENT_NOTE,
  types: Object.freeze(OFFERED_RIDE_TIERS.map((id) => {
    const catalog = RIDE_OPTION_CATALOG.find((row) => row.id === id)
    const note = RIDE_TYPE_NOTES[id]
    if (!catalog || !note) throw new Error(`Missing ride type copy for ${id}`)
    return Object.freeze({
      id,
      name: catalog.name,
      color: rideTypeColor(id),
      detail: note,
    })
  })),
})

function rideTypeColor(id) {
  switch (id) {
    case 'standard':
    case 'wait':
      return RIDE_TYPE_ORANGE
    case 'comfort':
    case 'carpool':
      return RIDE_TYPE_PURPLE
    default: {
      const unknown = id
      throw new Error(`Unknown ride type ${unknown}`)
    }
  }
}
