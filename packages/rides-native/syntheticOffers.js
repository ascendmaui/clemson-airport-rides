/**
 * Offers shown while a driver application is pending review.
 * They use the same card shape as live trips. isSynthetic keeps them off dispatch.
 */
import { driverNetCents } from './tripTags.js'

const APPROVAL_GATE = 'Finish approval to go online. Your account is still under review.'

export function approvalGateMessage() {
  return APPROVAL_GATE
}

export function syntheticOffers(now = new Date()) {
  const soon = new Date(now.getTime() + 12 * 60 * 1000).toISOString()
  const later = new Date(now.getTime() + 45 * 60 * 1000).toISOString()
  const evening = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString()
  return [
    offer({
      id: 'synthetic-tillman-gsp',
      pickupLabel: 'Tillman Hall',
      dropoffLabel: 'GSP Airport',
      pickupAt: soon,
      pickupLat: 34.6795,
      pickupLng: -82.8374,
      dropoffLat: 34.8957,
      dropoffLng: -82.2189,
      fareCents: 6800,
      firstName: 'Ava',
      riderRating: 4.9,
      etaMin: 4,
      distanceMi: 32,
      rideType: 'Airport',
      passengers: 1,
      tags: ['student'],
      tagLabels: ['Student'],
    }),
    offer({
      id: 'synthetic-downtown-campus',
      pickupLabel: 'Downtown Clemson · College Ave',
      dropoffLabel: 'The Pier',
      pickupAt: later,
      pickupLat: 34.6836,
      pickupLng: -82.8364,
      dropoffLat: 34.6742,
      dropoffLng: -82.8155,
      fareCents: 1400,
      firstName: 'Mason',
      riderRating: 4.8,
      etaMin: 6,
      distanceMi: 2.4,
      rideType: 'Campus',
      passengers: 2,
      tags: ['weekend_party'],
      tagLabels: ['Weekend'],
    }),
    offer({
      id: 'synthetic-stadium-gsp',
      pickupLabel: 'Memorial Stadium',
      dropoffLabel: 'GSP Airport',
      pickupAt: evening,
      pickupLat: 34.6788,
      pickupLng: -82.843,
      dropoffLat: 34.8957,
      dropoffLng: -82.2189,
      fareCents: 7400,
      firstName: 'Jordan',
      riderRating: 5,
      etaMin: 8,
      distanceMi: 33,
      rideType: 'Game day',
      passengers: 3,
      tags: ['game_day', 'student'],
      tagLabels: ['Game day', 'Student'],
    }),
  ]
}

export function isSyntheticOffer(card) {
  if (!card) return false
  if (card.isSynthetic === true) return true
  return String(card.id || '').startsWith('synthetic-')
}

function offer(row) {
  return {
    status: 'offered',
    driverId: null,
    riderId: null,
    depositCents: Math.round(row.fareCents * 0.25),
    depositExplicit: true,
    driverNetCents: driverNetCents(row.fareCents),
    purpose: row.rideType,
    tier: 'standard',
    teslaStub: false,
    arrivedAt: null,
    shares: [],
    riderLat: null,
    riderLng: null,
    isSynthetic: true,
    ...row,
  }
}
