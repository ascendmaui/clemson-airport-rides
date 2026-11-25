# Press blurb

Facts from the repo only. No founder quote, no funding figure, no rider count, no rating. Contact rides@clemsonrides.com. The public site is https://clemsonrides.com.

The iPhone Rider and Driver apps are on the App Store (https://apps.apple.com/us/app/clemson-rides/id6815430021 and https://apps.apple.com/us/app/clemson-rides-driver/id6815445517; `shared/productLinks.js`). Clemson Rides is iOS and web only.

## Short

Clemson Rides is a campus and airport ride marketplace for Clemson students. Riders book at clemsonrides.com. The ride types are Standard, Wait & Save, Extra Comfort, and Carpool. Scheduled airport trips use a $75 flat fare to Greenville-Spartanburg (GSP) and a $175 flat fare to Charlotte Douglas (CLT). A confirmed @clemson.edu or @g.clemson.edu email gets 10% off Standard. The App Store and Play Store listings are not live.

## Standard

Clemson Rides is a campus and airport ride marketplace for Clemson students, with a website at clemsonrides.com and separate rider and driver apps. Riders choose Standard, Wait & Save, Extra Comfort, or Carpool. The quote on the booking screen is the price before you confirm. Carpool is 50% of the Standard fare per seat when 3 or 4 riders split the trip. Scheduled airport rides go to Greenville-Spartanburg (GSP) at a $75 flat fare or Charlotte Douglas (CLT) at a $175 flat fare. Scheduling does not charge the card. Stripe places a pre-authorization hold for the estimated fare, and the full fare is charged when the trip ends.

A confirmed @clemson.edu or @g.clemson.edu email gets 10% off Standard. Other ride types are not included in that student discount. Tiger Pass is $9.99 a month and takes 10% off Standard, Wait & Save, Extra Comfort, and Carpool. Drivers keep 80% of the fare. A boost on a scheduled ride is all the driver’s. New drivers are not auto-approved. An application review is not a result from a screening company.

The Rider and Driver iPhone apps are on the App Store. Book on the web at https://clemsonrides.com/#/home. Press contact: rides@clemsonrides.com.

## Boilerplate facts

| Fact | Source |
| --- | --- |
| Product name Clemson Rides | `package.json`, `index.html` |
| Live site https://clemsonrides.com | `shared/productLinks.js` |
| Ride types Standard, Wait & Save, Extra Comfort, Carpool | `shared/rideOptions.js` |
| GSP $75 flat, CLT $175 flat | `src/store.js`, `server/productKnowledge.js` |
| Student 10% off Standard for a confirmed @clemson.edu or @g.clemson.edu email | `src/lib/fareRates.js`, `shared/copy/rideTypes.js` |
| Carpool 50% of Standard per seat when 3 or 4 riders split | `shared/copy/rideTypes.js` |
| Driver keeps 80%; platform fee 20% | `PLATFORM_FEE_BPS` in `src/lib/fareRates.js` |
| Rider and Driver on the App Store; iOS and web only | `shared/productLinks.js` |
| Support rides@clemsonrides.com | `shared/productLinks.js` |

Do not add the Clemson paw or other university trademarks. Any paw or trademark usage needs licensing review. See `STYLE_GUIDE.md`.
