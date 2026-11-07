# Landing copy

Use these blocks as written. They match the marketing site and the fare rules in the repo. Do not add a testimonial, a rating, or a count of riders or trips.

## Hero

Peace of mind, every ride

Source: `HOMEPAGE_HEADLINE` in `src/content/differentiators.js`.

Store subtitle, not submitted (`docs/store-metadata.md`): Peace of mind, door to airport.

## Subhead

Drivers confirm before they come. A backup is ready if they don't.

Source: `HOMEPAGE_SUBLINE` in `src/content/differentiators.js`.

The confirm window is 5 minutes (`BACKUP_CONFIRM_WINDOW_MS` in `shared/backupDriverQueue.js`). On a scheduled ride, a backup driver is $10 or $15 (`BACKUP_BONUS_PRESETS_CENTS`).

## Features

**Airport rides.** Schedule a ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT). The scheduled flats are $75 (GSP) and $175 (CLT) (`src/store.js`, `server/productKnowledge.js`). Stripe places a pre-authorization hold for the estimated fare plus a buffer. The full fare is charged when the trip ends (`shared/marketingFeatures.js`). Scheduling does not charge the card.

**Four ride types.** Standard, Wait & Save, Extra Comfort, and Carpool. The quote on the booking screen is the price before you confirm.

- Standard. The base ride. The fare on the booking screen is the price before you confirm.
- Wait & Save. Shown when a driver can serve it. The fare is the quote on that screen. The student discount does not apply. The default scale is 82% of Standard (`WAIT_SAVE_MULTIPLIER_BPS` in `src/lib/fareRates.js`).
- Extra Comfort. Nicer cars. Only a vehicle with service class comfort can take this ride. The default scale is 1.40× Standard (`COMFORT_FARE_MULTIPLIER_BPS`).
- Carpool. 50% of the Standard fare per seat when 3 or 4 riders split the trip. Pickup and drop-off each need to be nearby, and the times need to fall in the same window. Each rider is pre-authorized for their own seat. There is no deposit.

**Student discount.** 10% off Standard when the signed-in email is confirmed and ends with @clemson.edu or @g.clemson.edu. Other ride types are not included. The peace-of-mind page says that 10% includes the airport flats and does not include Carpool.

**Schedule.** Plan a pickup ahead of time from the Schedule tab. Schedule ahead and save 10% when the pickup qualifies (`SCHEDULE_AHEAD_DISCOUNT_PCT`). Weekend and party trips can be set at least 30 minutes ahead. Scheduling does not charge the card.

**Tiger Pass.** $9.99 a month. It takes 10% off Standard, Wait & Save, Extra Comfort, and Carpool. The discount comes after the student price and before schedule-ahead. Manage it from Account, Billing (`shared/tigerPass.js`).

**Boosts.** On a scheduled ride, add $5, $10, $15, or $20, or your own amount, up to $100. The driver keeps all of it (`shared/scheduledBoost.js`).

**Real-time matching and live trip.** A requested ride is offered to nearby drivers. The trip updates when a driver accepts. After a driver accepts, the trip screen follows the ride from pickup through drop-off.

**Message and lost items.** You can message after a driver accepts, and during the ride. Chat closes when the ride ends, except for a lost item.

**Safety.** Record audio or video on the phone during an active ride. The rider starts it, only after a driver accepts. The clip stays on the phone and is never uploaded. Share a live trip link. SOS can call 911 or Clemson Police, or send an in-app alert. The first press confirms and does not dial (`src/content/peaceOfMind.js`).

**Women-only.** If you identify as a woman, you can ask for a woman driver. Matching then skips drivers who do not match. If that check is unavailable, rides are not hidden.

**Drivers.** Driver net on a trip is 80% of the fare. The platform fee is 20% (`PLATFORM_FEE_BPS`). A scheduled boost is all the driver’s and is not part of that fee. New drivers are not auto-approved. Authorized means the driver consented and disclosed nothing that needs a look. It is not a result from a screening company (`docs/store-metadata.md`, `src/content/peaceOfMind.js`).

**Standing offers** (`shared/standingPromos.js`):

- A new account’s first completed trip is half off. No code to enter.
- Refer two friends who each sign up and confirm a @clemson.edu or @g.clemson.edu email.
- After two completed rides that each cost more than $20, the next ride is 50% off.
- Buy $100 of ride credits for $75. The wallet receives $100.

The Promos page also rotates a Friday code. This kit does not freeze a code, because the code changes with the week (`shared/weeklyCoupon.js`).

## Call to action

Primary: Book a ride. Destination: https://clemsonrides.com/#/home (`WEB_BOOK_URL`).

Secondary: Download the app. iPhone installs are the public TestFlight betas in `shared/productLinks.js`. Android opens the website while the Play Store listing is not live. Do not link an App Store or Play Store URL. Those constants are null.

Driver desk: https://clemsonrides.com/#/driver

Support: rides@clemsonrides.com

## FAQ

**How do I book?**
Book a ride, choose a destination, confirm the pickup, then pick Standard, Wait & Save, Extra Comfort, or Carpool. A type is shown only when a driver can serve it.

**How does carpool pricing work?**
Carpool is 50% of the Standard fare per seat when 3 or 4 riders split the trip. Pickup and drop-off each need to be nearby, and the times need to fall in the same window. Each rider is pre-authorized for their own seat. There is no deposit.

**Who gets the student discount?**
10% off Standard when the signed-in email is confirmed and ends with @clemson.edu or @g.clemson.edu. Other ride types are not included.

**When am I charged?**
Stripe places a pre-authorization hold for the estimated fare. The full fare is charged when the trip ends. Scheduling does not charge the card.

The airport feature line also says the hold is the estimated fare plus a buffer (`shared/marketingFeatures.js`). The FAQ sentence above is the one on the marketing FAQ page.

**Can I schedule an airport ride?**
Yes. Schedule a ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT).

**What is Tiger Pass?**
Tiger Pass takes 10% off Standard, Wait & Save, Extra Comfort, and Carpool. The price is $9.99 / month. Manage it from Account, Billing.

**What if I leave something in the car?**
You can message after a driver accepts and during the ride. Chat closes when the ride ends, except for a lost item.

## Source note

`docs/store-metadata.md` still says Carpool is 15% off, for 1 or 2 seats, and that it does not pair riders. That file says the listings are not submitted. Rider-facing copy in `shared/copy/rideTypes.js` and the FAQ in `src/screens/MarketingInfo.jsx` say 50% of the Standard fare per seat when 3 or 4 riders split the trip. This kit uses the rider-facing line.
