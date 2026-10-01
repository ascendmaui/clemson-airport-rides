/**
 * Parallel C. Home offer mount and queue accept/decline, read from source.
 * Does not edit the screens. Does not assert fare cents.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function sliceFn(source, start, end) {
  const i = source.indexOf(start)
  assert.ok(i >= 0, `missing ${start}`)
  const j = end ? source.indexOf(end, i + start.length) : source.length
  assert.ok(j > i, `missing ${end}`)
  return source.slice(i, j)
}

const home = read('apps/driver/app/(tabs)/index.tsx')
const queue = read('apps/driver/app/queue.tsx')
const homeAccept = sliceFn(home, 'async function onAccept', 'async function onDecline')
const homeDecline = sliceFn(home, 'async function onDecline', 'async function onPriority')
const homeToggle = sliceFn(home, 'async function toggle', 'async function onAccept')
const queueAccept = sliceFn(queue, 'async function onAccept', 'async function onDecline')
const queueDecline = sliceFn(queue, 'async function onDecline', 'const visible')
const rideCard = sliceFn(home, 'export function RideCard', 'const styles')

test('home shows only the first visible offer and hides it during a live trip', () => {
  assert.match(home, /const offer = canSeeOffers \? desk\?\.offers\[0\] \|\| null : null/)
  assert.match(home, /\{offer && !desk\?\.active \? \([\s\S]*<RideCard/)
  assert.match(home, /notice=\{null\}/)
  assert.equal(home.includes('offers.slice'), false)
  assert.equal(home.includes('offers.map'), false)
  assert.equal(home.includes('syntheticOffers('), false)
  assert.match(home, /import \{ approvalGateMessage, isSyntheticOffer, syntheticOffers \}/)
})

test('hiddenOffers is written on a synthetic decline and never read', () => {
  assert.equal((home.match(/\bhiddenOffers\b/g) || []).length, 1)
  assert.match(home, /const \[hiddenOffers, setHiddenOffers\] = useState<string\[\]>\(\[\]\)/)
  assert.match(homeDecline, /if \(isSyntheticOffer\(card\)\)/)
  assert.match(homeDecline, /setHiddenOffers\(\(current: string\[\]\) => \(current\.includes\(card\.id\) \? current : \[\.\.\.current, card\.id\]\)\)/)
  assert.equal(homeDecline.includes('declineTrip'), true)
  const afterSynthetic = homeDecline.slice(homeDecline.indexOf('isSyntheticOffer'))
  assert.match(afterSynthetic, /return/)
  assert.ok(afterSynthetic.indexOf('return') < afterSynthetic.indexOf('declineTrip'))
})

test('home accept is blocked for signed-out, unapproved, and synthetic cards', () => {
  assert.match(homeAccept, /if \(!user \|\| !supabase\) return/)
  assert.match(homeAccept, /if \(!canSeeOffers \|\| !approved \|\| isSyntheticOffer\(card\)\)/)
  assert.match(homeAccept, /setError\(approvalGateMessage\(\)\)/)
  assert.match(homeAccept, /await acceptTrip\(supabase, card, user\.id\)/)
  assert.match(homeAccept, /pathname: '\/trip'/)
  assert.match(homeAccept, /params: \{ id: card\.id \}/)
  assert.equal(homeAccept.includes('isOfferExpired'), false)
  assert.equal(home.includes('isOfferExpired'), false)
})

test('RideCard keeps Accept and Decline enabled after the countdown expires', () => {
  assert.match(rideCard, /disabled=\{busy\}/)
  assert.equal(rideCard.includes('isExpired'), false)
  assert.equal(rideCard.includes('isUrgent'), true)
  assert.match(rideCard, /color: vm\.timeLeft\.isUrgent \? colors\.orange : colors\.inkSecondary/)
  assert.match(rideCard, /accessibilityRole="summary"/)
  assert.match(rideCard, /accessibilityLabel=\{vm\.accessibilityLabel\}/)
  assert.match(rideCard, /accessibilityLabel=\{`Driver net pay \$\{vm\.pay\.formattedNet\}`\}/)
  assert.match(rideCard, /accessibilityLabel=\{busy \? 'Saving…' : `\$\{acceptActionLabel\(card\.status\)\} offer for \$\{vm\.pay\.formattedNet\}`\}/)
  assert.match(rideCard, /accessibilityLabel=\{declineActionLabel\(card\.status\)\}/)
  const declinePressable = rideCard.slice(rideCard.indexOf('<Pressable'))
  assert.match(declinePressable, /disabled=\{busy\}/)
  assert.match(rideCard, /declineDisposition\(card\.status\) === 'cancel' \? colors\.orange : colors\.inkSecondary/)
})

test('the offer card scrolls its body and pins the actions', () => {
  assert.match(rideCard, /scrollEnabled=\{overflows\}/)
  assert.match(rideCard, /showsVerticalScrollIndicator=\{overflows\}/)
  assert.match(rideCard, /bounces=\{overflows\}/)
  assert.match(rideCard, /overflows && \{ borderTopColor: colors\.border, borderTopWidth: StyleSheet\.hairlineWidth \}/)
  assert.match(rideCard, /if \(overflows\) scrollRef\.current\?\.flashScrollIndicators\(\)/)
  assert.match(home, /Pickup · \{card\.pickupLabel\}/)
  assert.match(home, /Drop-off · \{card\.dropoffLabel\}/)
})

test('queue accept does not repeat the home approval or synthetic pre-check', () => {
  assert.equal(queue.includes('offerCard'), false)
  assert.equal(queue.includes('offerCardViewModel'), false)
  assert.equal(queueAccept.includes('approvalGateMessage'), false)
  assert.equal(queueAccept.includes('canSeeOffers'), false)
  assert.equal(queueAccept.includes('isSyntheticOffer'), false)
  assert.equal(queueAccept.includes('approved'), false)
  assert.match(queueAccept, /if \(!user \|\| !supabase\) return/)
  assert.match(queueAccept, /setBusyId\(card\.id\)/)
  assert.match(queueAccept, /await acceptTrip\(supabase, card, user\.id\)/)
  assert.match(queueAccept, /if \(card\.status !== 'scheduled'\) router\.push\(\{ pathname: '\/trip', params: \{ id: card\.id \} \}\)/)
  assert.match(queueAccept, /setBusyId\(null\)/)
})

test('queue decline parks synthetic and scheduled cards locally', () => {
  assert.match(queueDecline, /if \(isSyntheticOffer\(card\)\)/)
  assert.match(queueDecline, /setPassed\(\(current: string\[\]\) => \(current\.includes\(card\.id\) \? current : \[\.\.\.current, card\.id\]\)\)/)
  assert.match(queueDecline, /if \(card\.status === 'scheduled'\)/)
  const scheduled = queueDecline.slice(queueDecline.indexOf("card.status === 'scheduled'"))
  assert.match(scheduled, /setPassed/)
  assert.match(scheduled, /pulse\('decline'\)/)
  assert.ok(scheduled.indexOf('return') < scheduled.indexOf('declineTrip'))
  assert.match(queue, /!passed\.includes\(card\.id\)/)
  assert.match(queue, /card\.status === 'scheduled'/)
  assert.match(queue, /card\.status !== 'scheduled'/)
})

test('queue copy and empty states follow the approval gate', () => {
  assert.match(queue, /\{canSeeOffers \? 'Accept rides' : 'Ride queue'\}/)
  assert.match(queue, /Ride requests and scheduled pickups will appear here once your driver application is approved\./)
  assert.match(queue, /\{!canSeeOffers \?/)
  assert.match(queue, /onOpen=\{\(\) => \{ if \(!isSyntheticOffer\(card\)\) router\.push\(\{ pathname: '\/trip', params: \{ id: card\.id \} \}\) \}\}/)
  assert.equal((queue.match(/onOpen=\{\(\) => \{ if \(!isSyntheticOffer\(card\)\)/g) || []).length, 2)
})

test('home status line and live trip card stay distinct from the offer', () => {
  assert.match(home, /const statusLine = !user/)
  assert.match(home, /\? 'Sign in to drive'/)
  assert.match(home, /: !canGoOnline/)
  assert.match(home, /\? gate\.title/)
  assert.match(home, /: online/)
  assert.match(home, /\? `You're online, \$\{name\}`/)
  assert.match(home, /: 'You\\'re offline'/)
  assert.match(home, /LIVE TRIP/)
  assert.match(home, /accessibilityLabel=\{`Active trip: \$\{statusHeadline\(desk\.active\.status\)\}, pickup \$\{desk\.active\.pickupLabel\}, drop-off \$\{desk\.active\.dropoffLabel\}`\}/)
  assert.match(home, /accessibilityHint="Opens active trip navigation"/)
})

test('safety modal on the driver home is separate from the rider SOS sheet', () => {
  assert.match(home, /Clemson University Police are \{CUPD_PHONE_DISPLAY\}/)
  assert.match(home, /If you are in danger, call 911\./)
  assert.match(home, /label="Call 911"/)
  assert.match(home, /Linking\.openURL\('tel:911'\)/)
  assert.match(home, /Linking\.openURL\(`tel:\$\{CUPD_PHONE_E164\}`\)/)
  assert.match(home, /accessibilityLabel="Close safety modal"/)
  assert.equal(home.includes('SosSheet'), false)
  assert.equal(home.includes('setSosEngaged'), false)
})
