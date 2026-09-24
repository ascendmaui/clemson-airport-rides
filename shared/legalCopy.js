/** One privacy policy and terms set for the website and the rider app. */

export const LEGAL_UPDATED = 'September 22, 2026'

export const PRIVACY_SECTIONS = [
  {
    heading: 'Who we are',
    paragraphs: [
      'Clemson RIDES (“we”, “us”) is a campus-focused airport ride product for Clemson University students and approved drivers. We help riders book flat-rate trips between campus and GSP/CLT airports, and we help drivers accept and complete those trips.',
    ],
  },
  {
    heading: 'Information we collect',
    paragraphs: [
      'To run the service we collect account and trip data, including:',
    ],
    bullets: [
      'Account details: name, email, and authentication identifiers from Supabase Auth. A Clemson (@clemson.edu) email may unlock student pricing.',
      'Student verification markers such as student_verified_at when your Clemson email is confirmed.',
      'Trip details: pickup/dropoff labels and coordinates, scheduled time, fare/deposit amounts, status history, and driver assignment.',
      'Payment metadata from Stripe Checkout (we do not store full card numbers on Clemson RIDES servers).',
      'Optional profile fields you provide (phone, home/work labels) and device/session signals needed for realtime trip updates.',
    ],
  },
  {
    heading: 'How we use information',
    paragraphs: [
      'We use this data to create accounts, apply student pricing when a Clemson email is used, match riders with drivers, process deposit payments, show live trip status, calculate driver earnings from completed fares, prevent abuse, and improve reliability of the campus airport-ride experience. We do not sell your personal information.',
    ],
  },
  {
    heading: 'Sharing',
    paragraphs: [
      'We share data only as needed to operate the product: with Stripe for deposits, with Supabase for auth/database/realtime, with drivers assigned to your trip (pickup, dropoff, and status), and when required by law or university policy. Aggregated, non-identifying stats may be used for campus operations reporting.',
    ],
  },
  {
    heading: 'Retention & security',
    paragraphs: [
      'Trip and account records are retained while your account is active and for a reasonable period afterward for dispute resolution, accounting, and safety. We use industry-standard controls via our providers (encrypted transport, access-controlled databases). No method of transmission is 100% secure; please use a strong password.',
    ],
  },
  {
    heading: 'Your choices',
    paragraphs: [
      'You may update profile details in Account, sign out at any time, and request deletion of your account/trip history by contacting Clemson RIDES support from Account. Marketing browse screens remain available without signup; booking and payment require a signed-in account.',
    ],
  },
  {
    heading: 'Children',
    paragraphs: [
      'Clemson RIDES is intended for university students and adults. We do not knowingly collect personal information from children under 13.',
    ],
  },
]

export const TERMS_SECTIONS = [
  {
    heading: 'Agreement',
    paragraphs: [
      'By creating a Clemson RIDES account or booking an airport ride, you agree to these Terms. If you do not agree, do not use the booking or driver features. Guest browsing of marketing and schedule information is allowed without an account.',
    ],
  },
  {
    heading: 'Eligibility',
    paragraphs: [
      'Anyone may create a rider or driver account with a valid email. Riders with a verified @clemson.edu address receive student pricing where offered. Drivers must submit their info and documents and wait for admin approval before they can receive rides. You are responsible for the accuracy of the information you provide.',
    ],
  },
  {
    heading: 'The service',
    paragraphs: [
      'Clemson RIDES connects student riders with drivers for scheduled campus-to-airport trips at published flat rates (for example GSP and CLT). A 25% deposit via Stripe holds your ride; remaining balance and any tips or adjustments may be handled as described in-app at the time of trip. Availability depends on online drivers and is not guaranteed for every requested time.',
    ],
  },
  {
    heading: 'Rider responsibilities',
    bullets: [
      'Be ready at the stated pickup location and time.',
      'Share accurate flight/schedule notes when relevant.',
      'Treat drivers and property respectfully; no illegal activity in vehicles.',
      'Cancel promptly if plans change; deposit refund rules follow the in-app and Stripe receipt terms.',
    ],
  },
  {
    heading: 'Driver responsibilities',
    bullets: [
      'Maintain a valid license, insurance, and vehicle fit for passenger transport.',
      'Advance trip status honestly (accepted, arriving, arrived, in progress, completed). Tap Arrive at pickup; a wait fee applies after a 3-minute grace.',
      'Complete only trips you accepted; do not solicit off-platform cash for Clemson RIDES bookings.',
    ],
  },
  {
    heading: 'Payments & earnings',
    paragraphs: [
      'Deposits are processed by Stripe. The platform keeps 20% of rider charges (fares, wait fees, and cancellation fees) and the driver keeps 80%. After a driver taps Arrive there is a 3-minute grace at $0, then $1 per minute (rounded up) while the trip stays arrived. On a completed trip that wait fee is split 20% platform / 80% driver. From 5 minutes the driver may cancel; the rider owes the wait fee accrued so far, with the same 20/80 split. At 7 minutes the ride cancels automatically: the rider is charged $5 ($4 wait + $1 cancellation fee), the driver keeps $4, and the platform keeps $1. If a saved card cannot be charged, the fee is still owed and recorded as pending. Payout timing and tax reporting (if any) will be disclosed in driver onboarding or Account. Chargebacks or fraud may result in account suspension.',
    ],
  },
  {
    heading: 'Disclaimers',
    paragraphs: [
      'Rides are provided by independent drivers, not as a university-operated transit service. Clemson RIDES is a software marketplace and is not a common carrier. To the fullest extent permitted by law, we disclaim warranties of uninterrupted availability and are not liable for indirect or consequential damages arising from delayed, canceled, or missed flights, traffic, or driver unavailability.',
    ],
  },
  {
    heading: 'Termination',
    paragraphs: [
      'We may suspend or terminate accounts that abuse the service, falsify Clemson affiliation, harass others, or violate these Terms. You may stop using the service at any time and may request account deletion from Account.',
    ],
  },
  {
    heading: 'Changes',
    paragraphs: [
      'We may update these Terms and the Privacy Policy. Material changes will be reflected by the “Last updated” date on this page. Continued use after changes constitutes acceptance.',
    ],
  },
  {
    heading: 'Contact',
    paragraphs: [
      'For terms or privacy questions related to Clemson RIDES campus airport rides, use Account → Support or your campus program administrator.',
    ],
  },
]
