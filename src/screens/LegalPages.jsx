import { navigate } from '../lib/navigation'

function LegalShell({ title, children }) {
  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface)' }}>
      <div style={{ padding: '20px 24px 48px', maxWidth: 640, margin: '0 auto' }}>
        <button
          type="button"
          className="pressable glass-pill"
          onClick={() => navigate('landing')}
          style={{ fontSize: 18, marginBottom: 16, width: 40, height: 40, borderRadius: 12 }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4, color: 'var(--purple)', marginBottom: 8 }}>
          {title}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 24 }}>
          Clemson RIDES · Campus airport rides · Last updated September 22, 2026
        </p>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink-secondary)' }}>{children}</div>
        <p style={{ marginTop: 32, fontSize: 13, color: 'var(--ink-tertiary)' }}>
          Questions? Contact support through the in-app Account screen or your Clemson RIDES campus lead.
        </p>
      </div>
    </div>
  )
}

function Section({ heading, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>{heading}</h2>
      {children}
    </section>
  )
}

export function LegalPrivacy() {
  return (
    <LegalShell title="Privacy Policy">
      <Section heading="Who we are">
        <p>
          Clemson RIDES (“we”, “us”) is a campus-focused airport ride product for Clemson University
          students and approved drivers. We help riders book flat-rate trips between campus and GSP/CLT
          airports, and we help drivers accept and complete those trips.
        </p>
      </Section>
      <Section heading="Information we collect">
        <p style={{ marginBottom: 10 }}>
          To run the service we collect account and trip data, including:
        </p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Account details: name, email, and authentication identifiers from Supabase Auth. A Clemson (@clemson.edu) email may unlock student pricing.</li>
          <li>Student verification markers such as <code>student_verified_at</code> when your Clemson email is confirmed.</li>
          <li>Trip details: pickup/dropoff labels and coordinates, scheduled time, fare/deposit amounts, status history, and driver assignment.</li>
          <li>Payment metadata from Stripe Checkout (we do not store full card numbers on Clemson RIDES servers).</li>
          <li>Optional profile fields you provide (phone, home/work labels) and device/session signals needed for realtime trip updates.</li>
        </ul>
      </Section>
      <Section heading="How we use information">
        <p>
          We use this data to create accounts, apply student pricing when a Clemson email is used, match riders with drivers,
          process deposit payments, show live trip status, calculate driver earnings from completed fares,
          prevent abuse, and improve reliability of the campus airport-ride experience. We do not sell your
          personal information.
        </p>
      </Section>
      <Section heading="Sharing">
        <p>
          We share data only as needed to operate the product: with Stripe for deposits, with Supabase for
          auth/database/realtime, with drivers assigned to your trip (pickup, dropoff, and status), and when
          required by law or university policy. Aggregated, non-identifying stats may be used for campus
          operations reporting.
        </p>
      </Section>
      <Section heading="Retention & security">
        <p>
          Trip and account records are retained while your account is active and for a reasonable period
          afterward for dispute resolution, accounting, and safety. We use industry-standard controls via
          our providers (encrypted transport, access-controlled databases). No method of transmission is
          100% secure; please use a strong password.
        </p>
      </Section>
      <Section heading="Your choices">
        <p>
          You may update profile details in Account, sign out at any time, and request deletion of your
          account/trip history by contacting Clemson RIDES support. Marketing browse screens remain available
          without signup; booking and payment require a signed-in account.
        </p>
      </Section>
      <Section heading="Children">
        <p>
          Clemson RIDES is intended for university students and adults. We do not knowingly collect personal
          information from children under 13.
        </p>
      </Section>
    </LegalShell>
  )
}

export function LegalTerms() {
  return (
    <LegalShell title="Terms of Service">
      <Section heading="Agreement">
        <p>
          By creating a Clemson RIDES account or booking an airport ride, you agree to these Terms. If you
          do not agree, do not use the booking or driver features. Guest browsing of marketing and schedule
          information is allowed without an account.
        </p>
      </Section>
      <Section heading="Eligibility">
        <p>
          Anyone may create a rider or driver account with a valid email. Riders with a verified
          <strong>@clemson.edu</strong> address receive student pricing where offered. Drivers must submit
          their info and documents and wait for admin approval before they can receive rides. You are
          responsible for the accuracy of the information you provide.
        </p>
      </Section>
      <Section heading="The service">
        <p>
          Clemson RIDES connects student riders with drivers for scheduled campus↔airport trips at published
          flat rates (e.g. GSP and CLT). A 25% deposit via Stripe holds your ride; remaining balance and any
          tips or adjustments may be handled as described in-app at the time of trip. Availability depends on
          online drivers and is not guaranteed for every requested time.
        </p>
      </Section>
      <Section heading="Rider responsibilities">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Be ready at the stated pickup location and time.</li>
          <li>Share accurate flight/schedule notes when relevant.</li>
          <li>Treat drivers and property respectfully; no illegal activity in vehicles.</li>
          <li>Cancel promptly if plans change; deposit refund rules follow the in-app and Stripe receipt terms.</li>
        </ul>
      </Section>
      <Section heading="Driver responsibilities">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Maintain a valid license, insurance, and vehicle fit for passenger transport.</li>
          <li>Advance trip status honestly (accepted → arriving → in progress → completed).</li>
          <li>Complete only trips you accepted; do not solicit off-platform cash for Clemson RIDES bookings.</li>
        </ul>
      </Section>
      <Section heading="Payments & earnings">
        <p>
          Deposits are processed by Stripe. Drivers see earnings based on completed trip fares recorded in
          Clemson RIDES. Platform fees, payout timing, and tax reporting (if any) will be disclosed in driver
          onboarding or Account. Chargebacks or fraud may result in account suspension.
        </p>
      </Section>
      <Section heading="Disclaimers">
        <p>
          Rides are provided by independent drivers, not as a university-operated transit service. Clemson
          RIDES is a software marketplace and is not a common carrier. To the fullest extent permitted by law,
          we disclaim warranties of uninterrupted availability and are not liable for indirect or consequential
          damages arising from delayed, canceled, or missed flights, traffic, or driver unavailability.
        </p>
      </Section>
      <Section heading="Termination">
        <p>
          We may suspend or terminate accounts that abuse the service, falsify Clemson affiliation, harass
          others, or violate these Terms. You may stop using the service at any time.
        </p>
      </Section>
      <Section heading="Changes">
        <p>
          We may update these Terms and the Privacy Policy. Material changes will be reflected by the “Last
          updated” date on this page. Continued use after changes constitutes acceptance.
        </p>
      </Section>
      <Section heading="Contact">
        <p>
          For terms or privacy questions related to Clemson RIDES campus airport rides, use the Account
          screen contact path or your campus program administrator.
        </p>
      </Section>
    </LegalShell>
  )
}
