# Ride with friends + Carpool — ship notes

## Payments (FINAL LOCK)
- SetupIntent save card (off_session)
- Organizer Confirm → off_session PI OR Payment Element / Apple Pay
- Full share; partial fail → retry; book only when all paid
- Do **not** invent Checkout pay-links for carpool (same as friends)

## Product — friends
1. /friends/:token (+ hash redirect)
2. Max 5; Routes optimize; automatic fare + surge
3. Fare split preview UI before charge
4. ride_bills itemized receipts
5. Ratings both sides; soft remind / skip
6. Multi-stop live tracking on Requested

## Product — carpool (kind=carpool)
1. Organizer (student-with-car) creates → shareable `/carpool/:token`
2. Also accept `/friends/:token?kind=carpool`
3. Hash redirect: `#/carpool/:token` → `/carpool/:token`
4. Riders join with pickup/dropoff (max 5); reuse friend-ride APIs
5. Google Routes + even/by_distance + automatic fare (friendRideLib)
6. Charge: saved card off_session OR Apple Pay / Payment Element
7. All paid → one trips row; `driver_id` = organizer (skip open matching → status accepted)
8. Trust UI: "Clemson student" badge when `student_verified_at`; show ratings
9. Entry: Marketing / Friends / Account / DriverHome "Offer a carpool"

## Env / blockers
- GOOGLE_MAPS_API_KEY (Vercel server Routes)
- VITE_GOOGLE_MAPS_API_KEY billed (Maps / CampusMap)
- Apple Pay domain in Stripe Dashboard
- sendmaui Maps billing if CampusMap blanks
