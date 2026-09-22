# Ride with friends MVP — ship notes

## Payments (FINAL LOCK)
- SetupIntent save card (off_session)
- Organizer Confirm → off_session PI OR Payment Element / Apple Pay
- Full share; partial fail → retry; book only when all paid

## Product
1. /friends/:token (+ hash redirect)
2. Max 5; Routes optimize; automatic fare + surge
3. Fare split preview UI before charge
4. ride_bills itemized receipts
5. Ratings both sides; soft remind / skip
6. Multi-stop live tracking on Requested

## Env
- GOOGLE_MAPS_API_KEY (Vercel server Routes)
- VITE_GOOGLE_MAPS_API_KEY billed
- Apple Pay domain in Stripe
