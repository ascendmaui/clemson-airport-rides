/** One privacy policy and terms set for the website and the rider app. */
import { supportEmail } from './productLinks.js'

export const LEGAL_UPDATED = 'October 16, 2026'

const SUPPORT = supportEmail()

export const PRIVACY_SECTIONS = [
  {
    heading: 'Article 1. Who We Are',
    paragraphs: [
      'Clemson Rides (“we”, “us”, “the Company”) is a technology platform for campus and airport rides used by Clemson University students and approved independent drivers. We help riders book flat-rate trips between campus and GSP/CLT airports, and we help drivers accept and complete those trips. The Company is not a transportation carrier and it does not provide transportation services. Our mailing address is 101 North Main Street, Greenville, SC 29601.',
      'This Privacy Policy describes categories of information the software handles, the purposes of that handling, and the choices you have. It is not a promise that anyone at the Company watches a trip, and it does not create a duty to protect you from another person. Drivers are independent contractors, not our employees or agents. Holding the data described below does not make the Company the provider of a ride or responsible for what happens on one.',
    ],
  },
  {
    heading: 'Article 2. Definitions',
    paragraphs: [
      'Capitalized words in this Privacy Policy have the following meanings. The same words in the Terms of Service have the meanings given there, and those meanings control if the two documents ever differ on a contract point.',
    ],
    bullets: [
      '“Company” means Clemson Rides, the operator of the Platform, which may be reached by mail at 101 North Main Street, Greenville, SC 29601.',
      '“Platform” means the Clemson Rides websites, mobile applications, and related software, including booking, matching, pricing, payment, messaging, and safety tools.',
      '“Services” means your access to that software. Services are not transportation and are not a promise that a vehicle will arrive.',
      '“Rider” means a person who requests a Ride through the Platform.',
      '“Driver” means an independent contractor who has been approved to receive ride requests through the Platform.',
      '“Ride” means a trip a Driver chooses to perform for a Rider after a match on the Platform.',
      '“Personal Information” means information that identifies, relates to, or could reasonably be linked with a particular person or household.',
      '“Third-Party Conduct” means an act or omission of a Rider, a Driver, or any other person who is not the Company.',
    ],
  },
  {
    heading: 'Article 3. Information We Collect',
    paragraphs: [
      'The categories of Personal Information the Platform collects, depending on how you use it, are listed below. We collect them from you, from the device you use, from payment and authentication providers, and from records a Ride generates.',
      'We also receive safety-related information you choose to send, such as an SOS event, a shared-trip link, a safety report, or a message to support. If you opt in to record audio or video, that recording stays on your device, as Article 6 explains, unless you later choose to attach a copy to a report.',
    ],
    bullets: [
      'Account details: name, email, and authentication identifiers from Supabase Auth. A Clemson (@clemson.edu) email may unlock student pricing.',
      'Student verification markers such as student_verified_at when your Clemson email is confirmed.',
      'Trip details: pickup/dropoff labels and coordinates, scheduled time, fare amounts, status history, and driver assignment.',
      'Payment metadata from Stripe Checkout (we do not store full card numbers on Clemson Rides servers).',
      'Optional profile fields you provide (phone, home/work labels) and device/session signals needed for realtime trip updates.',
      'Safety-tool events you start, including SOS, a call or text you place from the app, trip sharing, and emergency-contact labels you save for yourself.',
      'Driver application materials you submit, such as license, vehicle, insurance, and background-check information required before a Driver may go online.',
      'Records of an electronic acceptance, including the agreement version, the time of the clickwrap, and the app version or internet-protocol address when those are available.',
    ],
  },
  {
    heading: 'Article 4. How We Use Information',
    paragraphs: [
      'We use this data to create accounts, apply student pricing when a Clemson email is used, match riders with drivers, process fare payments, show live trip status, calculate driver earnings from completed fares, prevent abuse, and improve reliability of the campus airport-ride experience. We also use it to review safety reports, to investigate suspected violations of our Terms, and to respond to lawful process. We do not sell your personal information.',
      'Those purposes also include enforcing a zero-tolerance rule on drugs and alcohol, completing driver qualification and insurance acknowledgments, detecting fraud, and keeping the records a tax, payment, or safety investigation requires. Safety and investigation use can include preserving trip status, location associated with a trip, SOS events, and the messages you send us. That work is an administrative function of the software operator. It is not live supervision of a Ride, and it does not create a duty to prevent another person’s conduct.',
    ],
  },
  {
    heading: 'Article 5. Sharing',
    paragraphs: [
      'We share data only as needed to operate the product: with Stripe for card payments, with Supabase for auth, database, and realtime features, and with the driver or rider assigned to your trip only to the extent Article 7 allows. We share information with law enforcement, regulators, or other public authorities when we believe in good faith that the law requires it, that legal process such as a subpoena or court order compels it, or that disclosure may reduce an imminent risk of serious harm. Aggregated, non-identifying stats may be used for campus operations reporting.',
      'Safety sharing is limited to what the request reasonably needs: a safety report you filed, trip status, the first name shown on the Ride, and a recording you chose to send us. We may also share information with professional advisors, insurers, background-check vendors, and payment partners when a claim, a dispute, or a legal hold makes that sharing necessary, and with a successor if the business that operates the Platform is transferred. We do not give your information to advertisers for their own marketing. Helping a law-enforcement agency does not promise a particular outcome and does not add a duty beyond what this policy states.',
    ],
  },
  {
    heading: 'Article 6. Recordings',
    paragraphs: [
      'Riders who opt in to audio or video recording keep those recordings local, on their own device. The clip is not uploaded by the Platform, is not hosted by us, and is not reviewed by us unless the rider later chooses to provide a copy as part of a safety report or an investigation.',
      'Driver dashcam video and driver audio clips, when a driver uses those tools, are stored on the driver’s device. They are that driver’s records. The Company does not run a central recording archive and does not promise that a dashcam or an in-app recording was on, was saved, or will still exist after a trip.',
      'A recording control is optional, and the app shows when a clip is being made. Whether to record is your choice. If you voluntarily send us a file, we may keep it for the report or investigation it belongs to and may provide it to law enforcement when Article 5 allows. Having a file you sent does not mean we recorded the ride, and it does not create a duty to record, to keep every file, or to stop harm.',
    ],
  },
  {
    heading: 'Article 7. Names and Phone Numbers',
    paragraphs: [
      'Driver and rider names shown to the other party on a trip are first name only. We do not display a last name, a full legal name, or an email address to the person on the other side of a ride. Carpool and group screens follow the same first-name practice.',
      'Phone numbers are never shared between riders and drivers. A number you add to your account is used for that account, for support you start, and for safety tools you control, such as emergency contacts you save for yourself. It is not given to the other party, and ride chat is not a way to exchange personal phone numbers.',
      'Safety numbers shown in the app, including 911 and the Clemson Police number in the safety tools, are public emergency contacts. They are not another user’s private number. Trip sharing sends a live link to a person you pick. That link does not disclose the other party’s phone number.',
    ],
  },
  {
    heading: 'Article 8. Retention and Security',
    paragraphs: [
      'Trip and account records are retained while your account is active and for a reasonable period afterward for dispute resolution, accounting, driver-qualification files, and safety. Qualification and trip records that the South Carolina transportation-network statute would require a transportation network company to keep are retained for at least three years where that statute applies. We use industry-standard controls via our providers (encrypted transport, access-controlled databases). No method of transmission is 100% secure; please use a strong password.',
      'Safety reports, SOS records, and any clip you choose to send us may be kept for as long as we reasonably need them for an investigation, a legal hold, insurance, or a law-enforcement request, which can be longer than ordinary trip history. On-device recordings that you never send us are outside our retention because we do not have them. Keeping a record for safety is not an admission that we owed a duty to prevent the underlying event.',
    ],
  },
  {
    heading: 'Article 9. Your Rights and Choices',
    paragraphs: [
      'You may update profile details in Account, sign out at any time, and request deletion of your account/trip history by contacting Clemson Rides support from Account. Marketing browse screens remain available without signup; booking and payment require a signed-in account.',
      'You may decline optional recording and you may choose not to share a trip link. Emergency tools, including SOS and call 911, remain available so you can use them if you want. Closing an account does not erase a safety record, a tax record, or a qualification file we must keep for a legal process, a chargeback, or an investigation already underway.',
      'If a state privacy law applies to you and gives a right to know, access, correct, delete, or appeal, or a right to opt out of a sale or of targeted advertising, you may send that request from Account → Support or by mail to the address in Article 12. We will honor a right that statute actually gives you and that it does not allow a contract to waive. As of the date of this policy, South Carolina has not enacted a general consumer privacy statute of the California type. A request we cannot complete because another law requires us to keep the record will be explained to you.',
    ],
  },
  {
    heading: 'Article 10. Children',
    paragraphs: [
      'The Platform is not offered to children, and a person under 18 is not permitted to create an account, request a Ride, or drive. Clemson Rides is intended for university students and adults. We do not knowingly collect personal information from children under 13. If we learn that we have, we will delete it and close the account.',
    ],
  },
  {
    heading: 'Article 11. No Duty from This Policy',
    paragraphs: [
      'To the maximum extent permitted by applicable law, this Privacy Policy and the practices it describes do not create a duty of care, a duty to monitor, a duty to warn, or any liability for incidents, interactions, inappropriate behavior, illegal acts, sexual misconduct, harassment, abuse, assault, injury, or property damage or loss involving riders, drivers, or third parties, whether before, during, or after a ride. The Terms of Service — including the warranty disclaimer, the release, the damages limits, and binding individual arbitration — also govern disputes about privacy and safety data.',
      'We may update this policy. The “Last updated” date will change when we do, and continued use after that date is acceptance of the update. Every limit in this policy applies to the maximum extent permitted by applicable law. If a statute forbids a waiver of a privacy right, or forbids a limit on liability for gross negligence or willful misconduct, the statute controls for that point only and the rest of this policy stays in effect.',
    ],
  },
  {
    heading: 'Article 12. Contact',
    paragraphs: [
      `Privacy questions and privacy-rights requests may be sent to ${SUPPORT}, from Account → Support, or by mail to Clemson Rides, 101 North Main Street, Greenville, SC 29601. A mailed notice is effective when we receive it.`,
    ],
  },
  {
    heading: 'Article 13. Device Location, Notifications, and Cards',
    paragraphs: [
      'The Rider app uses precise device location while the app is in use to set your pickup.',
      'The Driver app uses precise device location while you are online or on a trip, including in the background. Location sharing stops when you go offline.',
      'The apps store a push notification token so Clemson Rides can send trip alerts to this phone. Payment cards are processed by Stripe.',
    ],
  },
]

export const TERMS_SECTIONS = [
  {
    heading: 'Article 1. Agreement',
    paragraphs: [
      'By creating a Clemson Rides account, requesting a ride, going online as a driver, or otherwise using the booking, payment, or driver features, you agree to these Terms of Service and to the Privacy Policy. If you do not agree, do not use those features. Guest browsing of marketing and schedule information is allowed without an account.',
      'These Terms are a contract between you and the Company. They bind every Rider, every Driver, and anyone else who uses the Platform. You represent that you can form a binding contract under South Carolina law and that you are using the Platform by your own choice.',
      'Section 1.1. The articles on the technology-platform role, independent contractors, the Driver Agreement, assumption of risk, disclaimers, limitation of liability, release, indemnification, safety cooperation, and arbitration allocate risk. Using the Platform after the “Last updated” date accepts the Terms then posted.',
      'Section 1.2. A Driver’s clickwrap is part of this contract. Checking the box and tapping “I Agree” is an electronic signature, as Article 20 describes, and it is acceptance of the Driver Agreement, these Terms, and the Privacy Policy in the versions then presented.',
    ],
  },
  {
    heading: 'Article 2. Definitions',
    paragraphs: [
      'Section 2.1. The following words, when capitalized, have the meanings in this Article. “Including” means “including without limitation.” Headings and article numbers are for convenience and do not narrow the text.',
    ],
    bullets: [
      '“Company” means Clemson Rides, the operator of the Platform. Notices go to 101 North Main Street, Greenville, SC 29601.',
      '“Platform” means the websites, applications, and software through which a person may request or accept a Ride, pay a fare, or use a safety tool.',
      '“Services” means the license to use that software. The Services are not transportation, and the Company does not provide transportation services.',
      '“Rider” means a person who uses the Platform to request a Ride.',
      '“Driver” means an independent contractor approved to accept requests on the Platform, and not an employee, agent, or partner of the Company.',
      '“Ride” means a prearranged trip that begins when a Driver accepts a Rider’s request on the Platform, continues while the Driver is en route and while the Rider is in the vehicle, and ends when the Rider exits. Where a Claim reaches events just before pickup or just after drop-off, “Ride” includes those events.',
      '“Personal Vehicle” means a vehicle the Driver owns, leases, or is authorized to use, which is not a taxi, charter bus, or other for-hire vehicle.',
      '“Third-Party Conduct” means any act or omission of a Rider, a Driver, a pedestrian, an airport, a university, an insurer, or any other person other than the Company.',
      '“Claims” means all claims, demands, actions, causes of action, damages, losses, fines, penalties, costs, and reasonable attorneys’ fees, known or unknown, in contract, tort, statute, or any other theory.',
      '“TNC Act” means the Transportation Network Company Act, S.C. Code Ann. Title 58, Chapter 23, Article 16, §§ 58-23-1610 et seq.',
      '“Zero-Tolerance Policy” means the rule in Article 11 that a Driver may not use drugs or alcohol while logged on or while providing a Ride.',
    ],
  },
  {
    heading: 'Article 3. Eligibility',
    paragraphs: [
      'Anyone may create a rider or driver account with a valid email. Riders with a verified @clemson.edu address receive student pricing where offered. Drivers must submit their info and documents and wait for admin approval before they can receive rides. You are responsible for the accuracy of the information you provide.',
      'Section 3.1. You must be at least 18 years old to use the Platform. A Driver must also be at least 21 years old before providing a Ride, must hold a valid driver’s license, and must complete the qualification steps in Articles 10 and 11. A person who is not eligible may not open an account for someone else in order to avoid those limits.',
    ],
  },
  {
    heading: 'Article 4. The Services',
    paragraphs: [
      'Clemson Rides connects student riders with drivers for scheduled campus-to-airport trips at published flat rates (for example GSP and CLT). Requesting a ride places a card hold for the estimated fare plus a buffer. The final fare is charged when the trip ends. Tips or adjustments may be handled as described in-app. Availability depends on online drivers and is not guaranteed for every requested time.',
      'What we offer in that sentence is software: a way to request, match, price, and pay. Any transportation that follows is performed by an independent Driver under Article 8 and Article 9. A quote, a hold, or a match is not a promise by the Company that a vehicle will arrive or that a trip will be finished.',
      'Section 4.1. Fares are disclosed in the app before you confirm. Payment for a Ride arranged on the Platform is made through the Platform. A Driver does not accept a street hail or a cash fare for a Clemson Rides booking.',
    ],
  },
  {
    heading: 'Article 5. Rider Responsibilities',
    bullets: [
      'Be ready at the stated pickup location and time.',
      'Share accurate flight/schedule notes when relevant.',
      'Treat drivers and property respectfully; no illegal activity in vehicles.',
      'Cancel promptly if plans change. A card hold that is not captured is released. Captured fares follow the in-app and Stripe receipt terms.',
    ],
  },
  {
    heading: 'Article 6. Driver Responsibilities',
    bullets: [
      'Maintain a valid license, insurance, and vehicle fit for passenger transport.',
      'Advance trip status honestly (accepted, arriving, arrived, in progress, completed). Tap Arrive at pickup; a wait fee applies after a 3-minute grace.',
      'Complete only trips you accepted; do not solicit off-platform cash for Clemson Rides bookings.',
    ],
  },
  {
    heading: 'Article 7. Payments & earnings',
    paragraphs: [
      'Card payments are processed by Stripe. The platform keeps 20% of rider charges (fares, wait fees, and cancellation fees) and the driver keeps 80%. After a driver taps Arrive there is a 3-minute grace at $0, then $1 per minute (rounded up) while the trip stays arrived. On a completed trip that wait fee is split 20% platform / 80% driver. From 5 minutes the driver may cancel; the rider owes the wait fee accrued so far, with the same 20/80 split. At 7 minutes the ride cancels automatically: the rider is charged $5 ($4 wait + $1 cancellation fee), the driver keeps $4, and the platform keeps $1. If a saved card cannot be charged, the fee is still owed and recorded as pending. Payout timing and tax reporting (if any) will be disclosed in driver onboarding or Account. Chargebacks or fraud may result in account suspension.',
      'Section 7.1. An electronic receipt after a completed Ride shows the origin, destination, duration and distance when the app has them, the fare, and the Driver’s first name. Payouts are consideration for use of the Platform and for a completed Ride. They are not wages, and the Company does not withhold payroll taxes except where a statute that validly applies later requires a withholding we will describe in writing.',
    ],
  },
  {
    heading: 'Article 8. Technology Platform',
    paragraphs: [
      'Clemson Rides is a technology platform that connects people who want a ride with independent drivers who choose to offer one. The Company is not a transportation carrier, a taxi company, a limousine service, or a common carrier, and it does not provide transportation services. We do not own, lease, or operate the vehicles used for trips, and we do not employ the people who drive them.',
      'Your use of the apps, websites, maps, fare quotes, and dispatch tools is a license to use software. It is not the sale of a ride by the Company. When a Driver accepts a request, transportation that follows is supplied by that Driver, in that Driver’s Personal Vehicle, on that Driver’s time. The Company does not control the manner or route of driving, does not ride along, and is not a party to the act of transporting someone.',
      'A logo, a campus color, an estimated arrival, or a status such as “arriving” does not make the Company the carrier and does not make a Driver our employee or agent. Clemson University does not operate the Platform and is not responsible for trips. The word “Clemson” in the product name identifies the community the software is built around. It is not a statement of university sponsorship.',
      'Section 8.1. If a statute, including the TNC Act, treats the Company as a transportation network company for a particular duty, the Company will meet that duty to the extent the statute requires and does not allow a contract to say otherwise. Meeting that duty does not make the Company the carrier, does not make a Driver an employee, and does not expand liability beyond the statute and Articles 13 through 16.',
    ],
  },
  {
    heading: 'Article 9. Independent Contractors',
    paragraphs: [
      'Drivers on the Platform are independent contractors. They are not employees, agents, partners, joint venturers, or representatives of Clemson Rides. A Driver chooses whether to open the app, whether to go online after approval, which requests to accept, and how to operate the Driver’s own vehicle within the law.',
      'The Company does not pay a wage, does not assign a shift, and does not withhold payroll taxes from trip payouts except where a statute later requires a withholding we will describe in writing. Drivers supply their own licenses, vehicles, fuel, insurance, and tax filings. Letting a Driver receive requests is permission to use software. It is not a public certification that the Driver is safe, and it gives the Driver no authority to speak for or bind the Company.',
      'Riders use a marketplace. They are not passengers of the Company. No Rider, Driver, airport, university, or other third party is a beneficiary of any promise that the Company will answer vicariously for someone else’s driving or personal conduct. Approved Drivers also accept the Driver Agreement. Where that agreement and these Terms both apply, the Driver must meet both, and on any question of the Company’s liability the provision that limits that liability more tightly is the one that controls.',
    ],
  },
  {
    heading: 'Article 10. Driver Agreement',
    paragraphs: [
      'Section 10.1. Status. Each driver who uses the Platform is an independent contractor. There is no employment, no agency, and no partnership between a driver and Clemson Rides. A driver is solely responsible for the driver’s own conduct, for the vehicle the driver uses, for the insurance that covers that driving, and for compliance with traffic law, airport rules, campus rules, the TNC Act to the extent it applies to the driver, and every other legal duty that applies to the driver.',
      'Section 10.2. Platform accountability. The platform may hold a driver accountable for access to the software. Accountability can include a warning, a suspension, a deactivation, or forfeiture of incentives, and the Company may use any of those measures at its sole discretion. Those measures decide whether the driver may keep using the Platform. They are not wages, not employee discipline, and not an undertaking to supervise the driving.',
      'Section 10.3. No liability for driver conduct. The platform shall never be held liable, to the fullest extent permitted by law, for any legal claim arising from a driver’s acts or omissions. That reaches claims by a rider, another driver, a pedestrian, an airport, a university, an insurer, or any other person, and it reaches injury, death, property damage or loss, harassment, and illegal conduct before, during, or after a ride. The limit applies to the maximum extent permitted by applicable law. It does not reach liability for gross negligence or willful misconduct, or any other liability, where a statute forbids the waiver.',
      'Section 10.4. Indemnity. The driver indemnifies and defends the platform. A driver will defend, indemnify, and hold harmless the Company and its owners, members, managers, officers, employees, agents, and affiliates from Claims arising out of the driver’s driving, vehicle, insurance, Third-Party Conduct involving the driver, or failure to follow the law, the Zero-Tolerance Policy, or these Terms. The Company may direct the defense of a covered Claim. This duty continues after access to the Platform ends.',
      'Section 10.5. Insurance acknowledgment. Before going online, the Driver acknowledges, in writing through this clickwrap, that: (a) automobile liability insurance the Company makes available, if any, applies only as its policy says while the Driver is logged on or engaged in a Ride; (b) the Driver’s personal automobile policy may not provide coverage while the Driver is logged on or engaged in a Ride; (c) using a financed or leased vehicle for Rides may breach the lien or lease, and the Driver must notify the lienholder and keep proof of that notice; and (d) driving for compensation may have personal income-tax and personal-property-tax consequences. The Driver will carry proof of the automobile liability insurance required for the period the Driver is logged on and for the period of a Ride.',
      'Section 10.6. Qualification acknowledgment. The Driver acknowledges that approval may require a valid license, confirmation that the Driver is at least 21, a driving-history review, a local and national criminal background check that includes a multijurisdictional criminal-records locator and a national sex-offender registry search, and proof of automobile liability insurance in the Driver’s name meeting S.C. Code Ann. § 38-77-140. The Driver will not go online if the Driver is a registrant on a sex-offender registry, has a disqualifying conviction described in S.C. Code Ann. § 58-23-1650, or cannot truthfully complete those items. The Company may re-check qualifications. A background check is not a warranty that the Driver is safe.',
      'Section 10.7. Zero tolerance, nondiscrimination, and service animals. The Driver will not use alcohol or any drug that could impair driving while logged on to the Platform or while providing a Ride. The Driver will not refuse or end a Ride because of destination, race, color, national origin, religious belief or affiliation, sex, disability, or age, except a refusal the TNC Act allows when a Rider is acting in an unlawful, disorderly, or endangering manner. Service animals and mobility equipment must be permitted to accompany a Rider. The Driver will not add a charge because a Rider has a disability.',
      'Section 10.8. Electronic signature. The Driver agrees that checking the unchecked box and tapping “I Agree,” before an account is created and again when this version is presented on a later launch, is the Driver’s electronic signature and the Driver’s consent to receive this Driver Agreement, the Terms, and the Privacy Policy in electronic form. That consent is given under the Electronic Signatures in Global and National Commerce Act, 15 U.S.C. § 7001 et seq., and the South Carolina Uniform Electronic Transactions Act, S.C. Code Ann. § 26-6-10 et seq. The Driver may withdraw consent to electronic records by closing the account, which also ends access to the Platform.',
      'Section 10.9. Accidents and insurance. To the fullest extent permitted by law, the Driver and the Driver’s automobile insurance carrier(s) are solely responsible for any accidents and all resulting liability, including injuries, death, and property damage, before, during, or after any Ride. The Driver must maintain insurance meeting the South Carolina TNC requirements: while logged on and available, and not yet engaged in a Ride, at least fifty thousand dollars for death and bodily injury per person, one hundred thousand dollars per incident, and fifty thousand dollars for property damage, plus uninsured-motorist coverage required by S.C. Code Ann. § 38-77-150; and while engaged in a Ride, at least one million dollars for death, bodily injury, and property damage, plus that uninsured-motorist coverage. The Driver acknowledges this responsibility in the clickwrap fine print before an account is created and again when this version is presented.',
      'Section 10.10. Company operations policy. The Company maintains only a standard commercial general liability policy for its own business operations. That policy is separate from, and does not extend to or cover, any Ride, Driver, or Rider incident, accident, injury, or interaction, except as otherwise required by applicable law. Trip-related coverage is provided by the Driver’s own insurance meeting the South Carolina TNC requirements in Section 10.9, except as otherwise required by applicable law.',
    ],
  },
  {
    heading: 'Article 11. South Carolina TNC Compliance',
    paragraphs: [
      'Section 11.1. Statute. South Carolina regulates transportation network companies in the TNC Act, S.C. Code Ann. Title 58, Chapter 23, Article 16, §§ 58-23-1610 et seq. This Article states the insurance, background-check, zero-tolerance, nondiscrimination, and service-animal rules a Driver acknowledges. It does not admit that the Company is a carrier, and it does not provide transportation services. To the extent the TNC Act validly imposes a duty that a contract cannot disclaim, that duty is performed and is not enlarged by this Article.',
      'Section 11.2. Insurance periods. While a Driver is logged on and available, and not yet engaged in a Ride, primary automobile liability insurance of at least fifty thousand dollars for death and bodily injury per person, one hundred thousand dollars per incident, and fifty thousand dollars for property damage, plus uninsured-motorist coverage required by S.C. Code Ann. § 38-77-150, must be in force. While a Driver is engaged in a Ride, primary automobile liability insurance of at least one million dollars for death, bodily injury, and property damage, plus that uninsured-motorist coverage, must be in force. The TNC Act allows those limits to be satisfied by insurance the Driver maintains, by insurance a transportation network company maintains, or by both. Trip-related coverage is provided by the Driver’s own insurance meeting these South Carolina TNC requirements, except as otherwise required by applicable law. If the Driver’s own policy does not meet the limit that applies, the Driver will not go online. A personal policy may exclude coverage during those periods, as S.C. Code Ann. § 58-23-1625 permits an insurer to do.',
      'Section 11.3. Zero-Tolerance Policy. The Company maintains a Zero-Tolerance Policy on drugs and alcohol. A Driver may not be under the influence of drugs or alcohol while providing a Ride or while logged on and available. A Rider may report a suspected violation from the app or from Account → Support. On a credible report, the Company will suspend the Driver’s access for the duration of the inquiry and may deactivate the Driver at its sole discretion. Nothing in the TNC Act or this section requires the Company to drug-test a Driver. The policy is also notice under the standards of S.C. Code Ann. § 58-23-1650(F)(4).',
      'Section 11.4. Nondiscrimination and service animals. The Company will not discriminate against a Rider on the basis of destination, race, color, national origin, religious belief or affiliation, sex, disability, or age, and Drivers must follow the same rule. Service animals and mobility equipment must be permitted to accompany a Rider, consistent with S.C. Code Ann. § 58-23-1660. No extra charge is imposed because of a disability. If a wheelchair-accessible vehicle cannot be arranged, the app or support will direct the Rider to an alternate provider when one is known. A Driver may refuse a Rider who is acting in an unlawful, disorderly, or endangering manner.',
      'Section 11.5. No street hail. A Driver provides a Ride only after a match on the Platform. The Driver will not solicit or accept a street hail, and will not take cash for a Ride booked on the Platform, consistent with S.C. Code Ann. § 58-23-1660.',
      'Section 11.6. Who answers for an accident. To the fullest extent permitted by law, the Driver and the Driver’s automobile insurance carrier(s) are solely responsible for any accidents and all resulting liability, including injuries, death, and property damage. The Company is not that insurer. The coverage obligations are those named in Section 11.2: fifty thousand, one hundred thousand, and fifty thousand dollars while the Driver is logged on and available, and one million dollars while the Driver is engaged in a Ride, in each case plus the uninsured-motorist coverage S.C. Code Ann. § 38-77-150 requires. This section does not waive liability for gross negligence or willful misconduct where a statute forbids the waiver.',
      // ATTORNEY CONFIRMATION: S.C. Code Ann. § 58-23-1630(D) may require a
      // transportation network company to maintain, or to backstop from the
      // first dollar, the automobile coverage in § 58-23-1630 if the driver's
      // coverage lapses or does not meet the statute. Section 11.7 is not a
      // conclusion that no such duty exists. Counsel should confirm before
      // this sentence is treated as a coverage position.
      'Section 11.7. Company operations policy. The Company maintains only a standard commercial general liability policy for its own business operations. That policy is separate from, and does not extend to or cover, any Ride, Driver, or Rider incident, accident, injury, or interaction, except as otherwise required by applicable law. Trip-related coverage is provided by the Driver’s own insurance meeting the South Carolina TNC requirements named in Section 11.2, except as otherwise required by applicable law.',
    ],
  },
  {
    heading: 'Article 12. Assumption of Risk',
    paragraphs: [
      'You use the service, and you take rides, at your own risk and by your own choice. Requesting a pickup, accepting a request, entering a vehicle, or staying in one is voluntary. You may decline a match, cancel under the product rules, or stop using the Platform. Riding in a private vehicle with another person carries risks we cannot remove, including traffic, weather, driver error, a mechanical problem, crime, and the way other people behave.',
      'You acknowledge that you have access to in-app safety features and that you decide whether to use them. Those features include the safety area in the app, SOS, call 911, a call to Clemson Police at the number the safety tools display, trip sharing by a live link, and safety numbers you save as emergency contacts. A feature’s presence gives you a way to ask for help. It does not mean staff are watching the ride, that someone from the Company will intervene, or that the Company has taken on your safety as its own obligation.',
      'YOU EXPRESSLY ASSUME THE RISK OF THIRD-PARTY CONDUCT AND OF WHAT CAN HAPPEN BEFORE A DRIVER ARRIVES, WHILE YOU ARE TOGETHER, AND AFTER YOU LEAVE THE VEHICLE, INCLUDING WHEN THE APP STATUS HAS ALREADY CHANGED. THAT INCLUDES INAPPROPRIATE BEHAVIOR AND OTHER PERSONAL CONDUCT BY A RIDER, A DRIVER, OR ANY OTHER PERSON. IF YOU ARE IN DANGER, CONTACT EMERGENCY SERVICES DIRECTLY. DO NOT WAIT ON AN IN-APP REPLY.',
      'To the fullest extent permitted by law, you assume the risk of motor vehicle accidents, collisions, and crashes, and of the bodily injury, death, or property damage that results, before, during, or after any Ride. That risk includes the Driver’s operation of a Personal Vehicle, the condition of the road, and other motorists. If an accident happens, the Rider must report it promptly through the app, after contacting emergency services if anyone is hurt.',
    ],
  },
  {
    heading: 'Article 13. Disclaimers',
    paragraphs: [
      'Rides are provided by independent drivers, not as a university-operated transit service. Clemson Rides is a software marketplace and is not a common carrier. Transportation, when it happens, is performed only by the driver who accepts the request. The Company disclaims responsibility for the condition of a vehicle, the path a driver takes, and whether a driver or a rider follows the law.',
      'THE PLATFORM, THE APPS, THE WEBSITES, THE SERVICES, AND EVERY RELATED FEATURE ARE PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE FULLEST EXTENT PERMITTED BY LAW, THE COMPANY DISCLAIMS EVERY WARRANTY, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, AND NON-INFRINGEMENT, AND ANY WARRANTY THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE, OR FREE OF ERRORS. WE DO NOT WARRANT THAT A DRIVER WILL BE NEARBY, THAT AN ARRIVAL TIME OR A FARE WILL BE RIGHT, THAT A FLIGHT WILL BE MET, OR THAT A TRIP WILL BE SAFE OR COMPLETED.',
      'The Company is not responsible for incidents or interactions connected with the Platform or a Ride. That responsibility is disclaimed for inappropriate behavior, illegal acts, sexual misconduct, harassment, abuse, assault, personal injury, and property damage or loss, whether the event is before, during, or after a Ride, and whether the people involved are Riders, Drivers, or other persons. The disclaimer also reaches conduct off the Platform when it involves someone you met through a trip.',
      'TO THE FULLEST EXTENT PERMITTED BY LAW, THE COMPANY DISCLAIMS RESPONSIBILITY FOR MOTOR VEHICLE ACCIDENTS, COLLISIONS, AND CRASHES, AND FOR BODILY INJURY, DEATH, OR PROPERTY DAMAGE RESULTING FROM THEM, WHETHER BEFORE, DURING, OR AFTER ANY RIDE.',
      'Accident claims shall be directed to the applicable Driver’s insurance and to any statutorily required TNC insurance coverage, not to the Company. To the fullest extent permitted by law, the Driver and the Driver’s automobile insurance carrier(s) are solely responsible for any accidents and all resulting liability, including injuries, death, and property damage. A Rider must report an accident promptly through the app. A report lets the Company preserve trip records for the Driver, the insurers, and law enforcement. It does not make the Company the insurer or the carrier, and it does not waive a liability that a statute forbids waiving, including liability for gross negligence or willful misconduct.',
      'Some places do not allow particular warranty disclaimers. Where that is so, the disclaimers in this Article apply to the maximum extent permitted by applicable law, and any warranty a statute requires and does not let us disclaim is limited to the shortest duration and the narrowest scope that statute allows.',
    ],
  },
  {
    heading: 'Article 14. Limitation of Liability',
    paragraphs: [
      'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE COMPANY AND ITS OWNERS, MEMBERS, MANAGERS, OFFICERS, EMPLOYEES, AGENTS, AND AFFILIATES WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, MISSED FLIGHTS, MISSED CLASSES, EMOTIONAL DISTRESS, OR HARM TO REPUTATION, WHETHER THE CLAIM SOUNDS IN CONTRACT, TORT, STATUTE, OR ANOTHER THEORY, AND WHETHER OR NOT WE WERE TOLD SUCH DAMAGES MIGHT OCCUR. THIS EXCLUSION OF INDIRECT, CONSEQUENTIAL, AND PUNITIVE DAMAGES IS INTENDED TO BE AS BROAD AS A COURT WILL ENFORCE.',
      'Our aggregate monetary responsibility for every Claim arising out of these Terms, the Platform, the Services, or a Ride, including a Claim that is not validly released, will not exceed the greater of (a) the amount you paid through the Platform for the specific trip that gave rise to the Claim or (b) one hundred U.S. dollars (US$100). If you are a Driver, clause (a) means the platform fees the Company actually retained from your trips during the three months before the Claim, and if there are no such fees the cap is US$100. The cap is a single ceiling for all related Claims. It does not reset per person, per theory, or per incident.',
      'Those limits apply to injury, property damage or loss, and Third-Party Conduct, before pickup, during the trip, and after drop-off. The exclusion of consequential and punitive damages in the capitalized paragraph of this Article is part of the same bargain, restated here in ordinary type. The limits still apply if a limited remedy fails of its essential purpose. They do not apply to liability that a statute says cannot be capped or waived, including liability for gross negligence or willful misconduct where the statute forbids a waiver. In that case the rest of this Article continues to cover every Claim the law does allow us to limit.',
      'To the fullest extent permitted by law, the cap and the exclusion of damages cover motor vehicle accidents, collisions, and crashes, and the bodily injury, death, or property damage resulting from them, before, during, or after any Ride. An accident claim is directed to the applicable Driver’s insurance and to any statutorily required TNC insurance coverage, not to the Company.',
    ],
  },
  {
    heading: 'Article 15. Release and Waiver',
    paragraphs: [
      'To the maximum extent permitted by applicable law, you release and forever discharge Clemson Rides and its owners, members, managers, officers, employees, agents, contractors, affiliates, and successors from Claims arising out of the Platform, the Services, a Ride, or an interaction tied to a Ride. The release includes Claims you know about and, to the extent South Carolina law allows, Claims you do not yet know about.',
      'The released subject matter includes personal injury, death, property damage, property loss, emotional distress, and money loss. It includes Claims arising from inappropriate behavior, illegal acts, sexual misconduct, harassment, abuse, or assault. It includes Third-Party Conduct, and events before a Ride, during it, and after it. You give up Claims you might otherwise bring against the Company because of those events, except a Claim a statute says you cannot give up.',
      'To the fullest extent permitted by law, the release covers motor vehicle accidents, collisions, and crashes, and bodily injury, death, or property damage resulting from them, before, during, or after any Ride. The released party is the Company, not the Driver’s insurer and not any statutorily required TNC insurance coverage. The release does not reach liability for gross negligence or willful misconduct where a statute forbids the waiver.',
      'YOU WAIVE UNKNOWN CLAIMS TO THE EXTENT SOUTH CAROLINA LAW ALLOWS A WAIVER OF CLAIMS YOU DO NOT SUSPECT. This release is a material reason the Platform is offered at all. If a decision-maker holds that one slice of the release cannot be enforced against one Claim, every other part of the release and every other part of these Terms stays in force. You are not relying on any statement that the Company supervises Drivers or promises a safe trip.',
    ],
  },
  {
    heading: 'Article 16. Indemnification and Defense',
    paragraphs: [
      'You will defend, indemnify, and hold harmless Clemson Rides and its owners, members, managers, officers, employees, agents, affiliates, and service providers from any Claim arising out of or related to (a) your use of the Platform or the Services, (b) your conduct before, during, or after a Ride, (c) your interaction with a Rider, a Driver, or any other person, (d) your violation of law, the Zero-Tolerance Policy, or these Terms, (e) injury, death, or property damage or loss connected with a trip you requested or drove, and (f) a dispute between you and another user.',
      'We may choose counsel on a covered Claim at your expense, or we may require a defense by counsel we reasonably accept. You will not settle a matter that admits fault by the Company or that puts an obligation on the Company unless we agree in writing first. This indemnity continues after you close your account. It is meant to reach as far as the law will let an indemnity by a user of software reach.',
      'You do not have to indemnify the Company for the Company’s own gross negligence or willful misconduct, or for a liability a statute forbids a contract to shift onto you. If a consumer statute trims an indemnity, this Article is enforced only to the maximum extent permitted by applicable law and the trimmed piece is handled under Article 19.',
    ],
  },
  {
    heading: 'Article 17. Safety Cooperation',
    paragraphs: [
      'The Company will assist with a safety report you submit in the app or through support, in the practical sense of receiving it, preserving related account and trip records, and looking at what you sent. We will cooperate with law enforcement when we receive valid legal process or when we believe in good faith that sharing information may address an imminent risk of harm. That cooperation can include providing records we hold. It is not a commitment to investigate every report to a set depth or on a set clock.',
      'We may suspend or deactivate a Rider or a Driver who breaks these Terms, the Zero-Tolerance Policy, the in-app rules, or the law, or who presents a safety concern. We may do that at our sole discretion, with or without advance notice, and we may refuse further use of the Platform on the same basis. Where it is practical and lawful, we will indicate that access has ended. You may leave the Platform whenever you want.',
      'Help with a report, cooperation with authorities, a rating, a suspension, a deactivation, and the presence of SOS, call 911, trip sharing, or any other safety tool do not create a duty of care, a duty to protect, a duty to warn, or any other duty or liability. The Company does not undertake to police private behavior. Nothing in this Article makes us a guarantor of anyone’s safety or a supervisor of the people who use the software.',
    ],
  },
  {
    heading: 'Article 18. Dispute Resolution',
    paragraphs: [
      'Section 18.1. Informal notice. Before starting a formal Claim, you and the Company will try to work the dispute out informally. Send a notice that describes the dispute and the relief you want to the mailing address in Article 23, or we will send notice to the email on your account. If it is still open thirty (30) days after the notice is received, either side may begin arbitration. You do not have to finish that informal step before a small-claims case that this Article allows.',
      'Section 18.2. Individual arbitration. Except for an individual Claim that belongs in small-claims court, any dispute arising out of or relating to these Terms, the Driver Agreement, the Privacy Policy, the Platform, the Services, or a Ride will be resolved by binding individual arbitration. The American Arbitration Association will administer it under its Consumer Arbitration Rules when those rules fit the Claim, and otherwise under its Commercial Arbitration Rules. There will be one arbitrator. The seat and the hearing are in Greenville, South Carolina, unless the arbitrator picks another place in South Carolina that is fair to both sides, or the Consumer Arbitration Rules require a hearing by documents, telephone, or video. The Federal Arbitration Act, 9 U.S.C. § 1 et seq., governs this arbitration agreement, including its interpretation and enforcement. A court with jurisdiction may enter judgment on the award.',
      'Section 18.3. Class and collective waiver; jury waiver; small-claims carve-out. YOU AND THE COMPANY EACH WAIVE A JURY TRIAL AND WAIVE ANY RIGHT TO A CLASS ACTION, CLASS ARBITRATION, COLLECTIVE ACTION, OR REPRESENTATIVE ACTION. This class-action waiver means each side brings Claims only as an individual, and the arbitrator may award relief only to the individual who brought the Claim and only to the extent needed to resolve that one Claim. Either side may instead bring an individual action in a small-claims court of competent jurisdiction in South Carolina, including a magistrate’s court whose amount covers that one Claim, which is the small-claims carve-out, so long as the case stays in that court and is not joined with anyone else’s Claim.',
      'Section 18.4. Mass-arbitration batching. If 25 or more similar arbitration demands are asserted against the Company by the same counsel, or by coordinated counsel, within any 90-day period, those demands will proceed in batches of 25. Up to five bellwether matters from the first batch will be arbitrated first. The other demands in that filing wave are stayed, without prejudice to the individual Claim, while the bellwethers and a good-faith mediation of the remaining demands are completed. If the mediation does not resolve a demand, later batches proceed in order. The AAA’s Mass Arbitration Supplementary Rules apply to the extent they are in force and do not conflict with this Section. Batching does not allow a class or collective action, and the bellwether arbitrator does not decide a Claim that is not in that bellwether.',
      'Section 18.5. Delegation. Except for the small-claims carve-out and the question whether the class-action waiver is enforceable, the arbitrator, and not any court, has the exclusive authority to resolve disputes about the interpretation, applicability, enforceability, and formation of this arbitration agreement, including any claim that all or any part of it is void or voidable. This delegation clause is an agreement to arbitrate gateway issues and is governed by the Federal Arbitration Act. A court, not the arbitrator, decides whether the class-action waiver can be enforced and whether a particular Claim fits the small-claims carve-out.',
      'Section 18.6. Opt-out and interim relief. You may reject this arbitration agreement only by mailing a signed opt-out, with your name and the email on your account, to the address in Article 23 within thirty (30) days after you first accept these Terms. An opt-out received on time leaves every other Article in place, including the jury-trial waiver if a court holds that waiver enforceable apart from arbitration. Either side may ask a court of competent jurisdiction in South Carolina for temporary injunctive relief to protect confidential information, intellectual property, or safety while arbitration goes forward. If the class-action waiver is held unenforceable for a particular Claim, that Claim proceeds in court on an individual basis if the law requires, and the agreement to arbitrate still covers every other Claim.',
    ],
  },
  {
    heading: 'Article 19. Governing Law and Venue',
    paragraphs: [
      'South Carolina law governs these Terms, the Driver Agreement, and any dispute that is not arbitrated, without regard to conflict-of-law rules that would pick another state’s law. The Federal Arbitration Act governs the arbitration agreement in Article 18. Subject to that agreement, the state courts sitting in Greenville County, South Carolina, and the United States District Court for the District of South Carolina, are the exclusive venues for a court case, and you consent to personal jurisdiction in those courts.',
      'YOU AND THE COMPANY WAIVE ANY RIGHT TO A TRIAL BY JURY OF ANY CLAIM THAT IS HEARD IN COURT. You make that waiver knowingly, after an opportunity to reject arbitration under Section 18.6, and as a material term of being allowed to use the Platform.',
      'Section 19.1. These Terms do not waive liability for gross negligence or willful misconduct, or any other liability, where a statute forbids the waiver. Every disclaimer, release, indemnity, exclusion of damages, and cap on damages applies to the maximum extent permitted by applicable law and is enforced to that extent rather than thrown out. If these Terms ever conflict with a mandatory right under a statute that validly applies to you, the statute controls for that right alone.',
    ],
  },
  {
    heading: 'Article 20. General Provisions',
    paragraphs: [
      'Section 20.1. Severability and blue-pencil reformation. If any provision of these Terms or of the Driver Agreement is held invalid or unenforceable, a court or arbitrator will reform it by blue pencil to the minimum change that makes it valid, including by narrowing a time, a place, a damages cap, or a waiver. Only if reformation cannot save the provision will it be severed. The remaining provisions continue in full force. This severability rule is material.',
      'Section 20.2. Survival. The Driver Agreement, the assumption of risk, the disclaimers, the release, the indemnity, the limitation of liability, the arbitration agreement, the jury waiver, the TNC acknowledgments, and the electronic-signature consent survive closing an account, deactivation, and the end of a Ride.',
      'Section 20.3. Entire agreement. These Terms, the Driver Agreement they contain, and the Privacy Policy are the entire agreement between you and the Company about the Platform and the Services. They replace earlier oral statements and earlier versions of the same documents. A Driver’s separate signature-pad contractor form, where one was signed, still applies, and on any question of the Company’s liability the tighter limit controls.',
      'Section 20.4. No waiver. A failure to enforce a term once is not a waiver of the right to enforce it later. A waiver must be in a writing that refers to the term being waived. An acceptance of a late payment or a decision to give one warning is not a waiver of any other breach.',
      'Section 20.5. Assignment. The Company may assign these Terms, including in a financing, a reorganization, or a sale of the business that operates the Platform. You may not assign your account or these Terms without the Company’s prior written consent. Any attempted assignment by you without that consent is void.',
      'Section 20.6. Force majeure. The Company is not liable for a delay or failure caused by an event outside its reasonable control, including weather, a utility or network outage, a labor dispute, an epidemic, an act of government, or a failure of a payment, map, or authentication provider. A force-majeure event does not excuse a Driver’s duty to drive lawfully or a user’s duty to pay a fare already earned.',
      'Section 20.7. Electronic signatures and E-SIGN consent. You consent to receive these Terms, the Driver Agreement, the Privacy Policy, receipts, and related notices in electronic form, and you agree that an electronic acceptance has the same effect as a wet-ink signature. The consent is given under 15 U.S.C. § 7001 et seq. and S.C. Code Ann. § 26-6-10 et seq. For a Driver, the clickwrap is the signature: the box starts unchecked, the “I Agree” control stays disabled until the box is checked, and the record of acceptance stores the user id, the agreement version, the time, and the app version or internet-protocol address when those are available. You may obtain a paper copy by mailing a request to the address in Article 23. Withdrawing consent to electronic records closes further use of the Platform and does not unwind an acceptance already recorded.',
    ],
  },
  {
    heading: 'Article 21. Termination',
    paragraphs: [
      'We may suspend or terminate accounts that abuse the service, falsify Clemson affiliation, harass others, or violate these Terms, including under Article 17 and the Zero-Tolerance Policy, at our sole discretion. You may stop using the service at any time and may request account deletion from Account. Closing an account does not undo a release, an indemnity, a limitation of liability, or an arbitration agreement that already covers events from when you used the Platform.',
    ],
  },
  {
    heading: 'Article 22. Changes',
    paragraphs: [
      'We may update these Terms, the Driver Agreement, and the Privacy Policy. Material changes will be reflected by the “Last updated” date on this page. Continued use after changes constitutes acceptance. A Driver must accept a new Driver Agreement version on the next launch before the Driver can continue, and an older clickwrap version does not satisfy the new one.',
    ],
  },
  {
    heading: 'Article 23. Notices and Contact',
    paragraphs: [
      `For terms or privacy questions, email ${SUPPORT} or use Account → Support. Notices required by these Terms, including a notice that starts the informal dispute step and an arbitration opt-out, must be mailed to Clemson Rides, 101 North Main Street, Greenville, SC 29601. A mailed notice is effective when we receive it. The Company may give you notice at the email on your account, and that notice is effective when sent.`,
    ],
  },
  // ---------------------------------------------------------------------------
  // DRAFT ADDITIONS (2026-10-15). Not live: this exists only on the PR #485
  // branch. Articles 1-23 above are unchanged. Every lawyer note below is an
  // internal comment and is not shown to riders. Full list:
  // docs/legal/rider-terms-additions-2026-10-15.md
  // ---------------------------------------------------------------------------
  {
    heading: 'Article 24. Supplemental Protective Terms: Scope and Precedence',
    paragraphs: [
      'Section 24.1. Articles 24 through 30 are added to these Terms. They supplement Articles 1 through 23 and do not delete or rewrite them. Each provision in Articles 24 through 30 applies to the fullest extent permitted by applicable law.',
      'Section 24.2. Precedence. To the extent of any conflict between Articles 24 through 30 and any other provision of these Terms, the Driver Agreement, or the Privacy Policy, the provision that is more protective of Clemson Rides controls, to the fullest extent permitted by applicable law. A provision that a court or arbitrator will not enforce is not “more protective” for this purpose, and the next most protective enforceable provision controls instead.',
      'Section 24.3. In Articles 24 through 30, “Company Parties” means Clemson Rides and its past, present, and future owners, members, managers, officers, directors, employees, contractors, affiliates, agents, insurers, successors, and assigns. “Covered Matter” means anything arising out of or relating in any way to Clemson Rides; the Platform, the apps, or the website; any Company Party; any Driver; any Rider; any third party; or any Ride dispatched through the Platform, at any time, including before, during, and after a Ride, and whether the Driver is online, offline, or en route.',
    ],
  },
  // LAWYER REVIEW (R-3, R-6): Section 24.2 resolves conflicts in the Company's
  // favor. Conflicts with Articles 13, 14, 15, 16, 19.1, and 22 are listed in
  // the docs file. A one-sided precedence rule can itself support an
  // unconscionability finding.
  {
    heading: 'Article 25. Dispatch Platform and Independent Drivers',
    paragraphs: [
      'Section 25.1. Clemson Rides is a technology and dispatch platform that connects Riders with independent-contractor Drivers. Clemson Rides is not a transportation carrier, common carrier, or motor carrier, does not provide transportation services, and is not the employer of any Driver. Drivers, not Clemson Rides, provide the transportation.',
      'Section 25.2. When a Driver accepts your request, any transportation that follows is a separate transaction between you and that Driver. Clemson Rides collects the fare for that transaction as the Driver’s limited payment collection agent, and your payment through the Platform satisfies your payment obligation to the Driver for that Ride.',
      'Section 25.3. Drivers are not actual, apparent, or ostensible agents or employees of Clemson Rides. Any safety feature, screening step, standard, rating, policy, deactivation, or other effort by Clemson Rides, whether or not a law requires it, is not evidence of an employment, agency, or control relationship with any Driver and is not an undertaking to supervise any Ride.',
      'SECTION 25.4. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE ENTIRE RISK ARISING OUT OF YOUR USE OF THE PLATFORM AND OF ANY RIDE REMAINS WITH YOU. MATCHING, PRICING, ROUTING, AND LOCATION FEATURES, INCLUDING ANY USE OF ALGORITHMS, ARE NOT A GUARANTEE OR WARRANTY OF ANY KIND, AND LOCATION DATA IS NOT INTENDED FOR USE WHERE AN ERROR COULD CAUSE INJURY OR LOSS.',
    ],
  },
  // LAWYER REVIEW (R-4): dispatch-only framing versus the SC TNC Act
  // (S.C. Code Ann. §§ 58-23-1610 et seq.), which places insurance, screening,
  // zero-tolerance, nondiscrimination, and record duties on the TNC itself.
  {
    heading: 'Article 26. Supplemental Assumption of Risk',
    paragraphs: [
      'SECTION 26.1. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, YOU KNOWINGLY, VOLUNTARILY, AND EXPRESSLY ASSUME ALL RISKS OF EVERY KIND, KNOWN AND UNKNOWN, ARISING OUT OF OR RELATING IN ANY WAY TO ANY COVERED MATTER, INCLUDING TRAFFIC COLLISIONS, THE CONDUCT OF DRIVERS, RIDERS, AND OTHER PERSONS, CRIME, WEATHER, ROAD AND VEHICLE CONDITIONS, AND PLATFORM ERRORS OR OUTAGES, AT ANY TIME, BEFORE, DURING, AND AFTER ANY RIDE.',
      'SECTION 26.2. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THIS ASSUMPTION OF RISK INCLUDES RISKS ARISING FROM THE NEGLIGENCE OF ANY COMPANY PARTY, WHETHER ACTIVE, PASSIVE, SOLE, OR CONCURRENT, AND INCLUDES RISKS ARISING FROM GROSS NEGLIGENCE AND ANY OTHER CONDUCT.',
    ],
  },
  // LAWYER REVIEW (R-1, R-2): John asked that Articles 26-28 include gross
  // negligence "to the fullest extent permitted by applicable law." SC courts
  // generally will not enforce a release, assumption of risk, or indemnity for
  // gross negligence, recklessness, or intentional conduct. Including it risks
  // the entire clause being struck rather than narrowed (see Huskins v. Mungo
  // Homes, S.C. 2024, refusing to sever an unlawful term from an adhesion
  // contract). Counsel must confirm scope.
  {
    heading: 'Article 27. Supplemental Release, Unknown Claims, and Covenant Not to Sue',
    paragraphs: [
      'SECTION 27.1. RELEASE. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, YOU, FOR YOURSELF AND YOUR HEIRS, ESTATE, REPRESENTATIVES, GUESTS FOR WHOM YOU BOOK A RIDE, AND ASSIGNS, RELEASE, WAIVE, AND FOREVER DISCHARGE THE COMPANY PARTIES FROM ANY AND ALL CLAIMS OF ANY KIND, KNOWN OR UNKNOWN, SUSPECTED OR UNSUSPECTED, ARISING OUT OF OR RELATING IN ANY WAY TO ANY COVERED MATTER, INCLUDING CLAIMS FOR PERSONAL INJURY, DEATH, PROPERTY DAMAGE OR LOSS, EMOTIONAL DISTRESS, AND ECONOMIC LOSS.',
      'SECTION 27.2. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THIS RELEASE INCLUDES CLAIMS BASED ON THE NEGLIGENCE OF ANY COMPANY PARTY, WHETHER ACTIVE, PASSIVE, SOLE, OR CONCURRENT, AND INCLUDES CLAIMS BASED ON GROSS NEGLIGENCE AND ANY OTHER CLAIM. IF A LAW DOES NOT ALLOW A PARTICULAR CLAIM TO BE RELEASED, THIS RELEASE APPLIES TO EVERY OTHER CLAIM AND IS NARROWED ONLY AS FAR AS THAT LAW REQUIRES.',
      'SECTION 27.3. UNKNOWN CLAIMS. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, YOU EXPRESSLY WAIVE THE BENEFIT OF ANY STATUTE, RULE, OR DOCTRINE THAT WOULD LIMIT A GENERAL RELEASE TO CLAIMS YOU KNOW OR SUSPECT WHEN YOU ACCEPT THESE TERMS. YOU UNDERSTAND THAT YOU MAY LATER DISCOVER FACTS OR CLAIMS YOU DO NOT NOW KNOW, AND YOU INTEND THIS RELEASE TO APPLY TO THEM.',
      'SECTION 27.4. COVENANT NOT TO SUE. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, YOU AGREE NOT TO SUE OR BRING ANY ARBITRATION OR OTHER PROCEEDING AGAINST ANY COMPANY PARTY ON ANY CLAIM RELEASED IN THIS ARTICLE. THIS COVENANT DOES NOT BAR A REPORT OR CHARGE TO A GOVERNMENT AGENCY, A CLAIM THAT IS NOT RELEASED, OR A PROCEEDING TO ENFORCE THESE TERMS.',
      'Section 27.5. This release concerns Claims against the Company Parties. It does not release your Claims against a Driver personally or against the Driver’s insurer or any statutorily required TNC insurance coverage, which you may pursue directly.',
    ],
  },
  // LAWYER REVIEW (R-1, R-3, R-5): conflicts with Article 15 (paragraphs 1-3)
  // and Article 19.1, which exclude gross negligence and willful misconduct
  // where a statute forbids the waiver; consumer-protection limits on waivers
  // in adhesion consumer contracts (SC Unfair Trade Practices Act,
  // unconscionability). Section 27.5 is a deliberate carve-out so the release
  // is not read to cover parties who are not in the contract.
  {
    heading: 'Article 28. Supplemental Indemnity and Damages Limits',
    paragraphs: [
      'Section 28.1. Rider indemnity. To the fullest extent permitted by applicable law, you will defend, indemnify, and hold harmless the Company Parties from and against any and all Claims arising out of or relating in any way to your use of the Platform, any Ride you request or take, your guests, your conduct toward any Driver or other person, or your breach of these Terms or of any law. This indemnity applies without regard to the negligence of any party, including the negligence of the Company Party seeking indemnity, to the fullest extent permitted by applicable law. You will not settle any Claim that imposes an obligation on, or admits fault by, a Company Party without the Company’s prior written consent.',
      'SECTION 28.2. EXCLUSION OF CONSEQUENTIAL DAMAGES. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, NO COMPANY PARTY WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, MISSED FLIGHTS, OR LOSS OF GOODWILL, ARISING OUT OF OR RELATING IN ANY WAY TO ANY COVERED MATTER, HOWEVER CAUSED AND UNDER ANY THEORY, REGARDLESS OF THE NEGLIGENCE OF ANY COMPANY PARTY, AND EVEN IF ADVISED OF THE POSSIBILITY.',
      'SECTION 28.3. CAP. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE TOTAL AGGREGATE LIABILITY OF ALL COMPANY PARTIES FOR ALL CLAIMS ARISING OUT OF OR RELATING IN ANY WAY TO ANY COVERED MATTER WILL NOT EXCEED THE GREATER OF ONE HUNDRED U.S. DOLLARS (US$100) OR THE AMOUNTS YOU PAID THROUGH THE PLATFORM IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE FIRST CLAIM. UNDER SECTION 24.2, IF ARTICLE 14 PROVIDES A LOWER ENFORCEABLE LIMIT, THAT LOWER LIMIT CONTROLS.',
      'SECTION 28.4. THESE LIMITS APPLY EVEN IF A LIMITED REMEDY FAILS OF ITS ESSENTIAL PURPOSE. THEY DO NOT LIMIT ANY RIGHT THAT APPLICABLE LAW SAYS CANNOT BE LIMITED, AND IN THAT CASE THEY APPLY TO THE MAXIMUM EXTENT THAT LAW ALLOWS.',
    ],
  },
  // LAWYER REVIEW (R-5, R-7): South Carolina enforces indemnity for an
  // indemnitee's own negligence only when stated clearly and unequivocally;
  // Section 28.1 is drafted to meet that test. Section 28.3 cap (greater of
  // US$100 or 12 months of spend) is higher than Article 14 (greater of the
  // trip amount or US$100); under Section 24.2 the lower Article 14 cap
  // controls. Counsel to choose.
  {
    heading: 'Article 29. Supplemental Dispute Resolution Terms',
    paragraphs: [
      'Section 29.1. These Sections add to Article 18 and do not replace it. If the Federal Arbitration Act is held not to apply to a dispute, the arbitration agreement in Article 18 is governed by the South Carolina Uniform Arbitration Act, S.C. Code Ann. § 15-48-10 et seq., to the fullest extent permitted by applicable law.',
      'Section 29.2. The class, collective, and representative-action waiver in Section 18.3 is not severable from the agreement to arbitrate. If a court finally holds that waiver unenforceable for a Claim, that Claim proceeds in court on an individual basis if the law allows, and is stayed until any arbitrable Claims are resolved. A court, not an arbitrator, decides the validity of that waiver.',
      'Section 29.3. For a Rider’s individual Claim, the Company will pay all arbitration filing, administrative, and arbitrator fees above the amount of the filing fee you would pay to bring the same Claim in a South Carolina court. Each party pays its own attorneys’ fees unless the arbitrator awards fees under applicable law.',
      'Section 29.4. Any applicable statute of limitations is tolled while the informal notice period in Section 18.1 runs. Nothing in these Terms shortens any statute of limitations. This arbitration agreement also binds your heirs, estate, and the guests for whom you book a Ride, to the extent their Claims arise from your use of the Platform, and you will make these Terms available to those guests.',
      'Section 29.5. The Company will not retaliate against you for opting out of arbitration under Section 18.6.',
    ],
  },
  // LAWYER REVIEW (R-8): arbitration and class waiver, including the SC UAA
  // fallback, § 15-48-10(a) first-page notice, delegation, batching (18.4),
  // and binding guests. Deliberately no shortened claims deadline:
  // S.C. Code Ann. § 15-3-140 voids it, and Huskins v. Mungo Homes (S.C. 2024)
  // struck an entire arbitration agreement over a 90-day deadline.
  {
    heading: 'Article 30. Supplemental Acknowledgment, Changes, Severability, and Survival',
    paragraphs: [
      'Section 30.1. Changes. For a material change to Articles 12 through 19 or 24 through 30, the Company will ask you to accept the updated Terms affirmatively in the app or on the website before your next booking. This is in addition to Article 22.',
      'Section 30.2. Severability and reformation. If any part of Articles 24 through 30 is held invalid, unenforceable, or against public policy, a court or arbitrator will reform it to the minimum extent necessary to make it enforceable, replacing it with a valid term that has, as closely as possible, the same effect, and narrowing its scope, the Claims it covers, or its amount rather than striking it. Only if reformation is impossible will that part be severed, and every other part of these Terms stays in force. Article 20.1 also applies.',
      'Section 30.3. Survival. Articles 24 through 30 survive account closure, deactivation, termination of these Terms, and the end of any Ride.',
      'SECTION 30.4. ACKNOWLEDGMENT. BY CREATING AN ACCOUNT, REQUESTING A RIDE, OR TAPPING “I AGREE,” YOU CONFIRM THAT YOU HAVE READ AND UNDERSTOOD THESE TERMS, INCLUDING THE ASSUMPTION OF RISK, RELEASE, UNKNOWN-CLAIMS WAIVER, COVENANT NOT TO SUE, INDEMNITY, DAMAGES LIMITS, AND ARBITRATION AGREEMENT; THAT YOU HAVE HAD TIME TO CONSIDER THEM AND THE OPPORTUNITY TO CONSULT A LAWYER; AND THAT YOU KNOWINGLY AND VOLUNTARILY GIVE UP THE RIGHTS THEY DESCRIBE. YOUR ELECTRONIC ACCEPTANCE IS YOUR SIGNATURE UNDER ARTICLE 20.7.',
    ],
  },
  // LAWYER REVIEW (R-9): whether existing riders must re-accept. The web
  // "agree" button stores LEGAL_UPDATED in sessionStorage only; a stored,
  // per-user clickwrap record would better support Section 30.4. LEGAL_UPDATED
  // and the driver clickwrap version were left unchanged on purpose.
]
