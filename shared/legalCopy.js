/** One privacy policy and terms set for the website and the rider app. */

export const LEGAL_UPDATED = 'October 13, 2026'

export const PRIVACY_SECTIONS = [
  {
    heading: 'Who we are',
    paragraphs: [
      'Clemson RIDES (“we”, “us”, “the Company”) is a technology platform for campus and airport rides used by Clemson University students and approved independent drivers. We help riders book flat-rate trips between campus and GSP/CLT airports, and we help drivers accept and complete those trips. The Company is not a transportation carrier and it does not provide transportation services. Our mailing address is 101 North Main Street, Greenville, SC 29601.',
      'This Privacy Policy describes information the software handles. It is not a promise that anyone at the Company watches a trip, and it does not create a duty to protect you from another person. Drivers are independent contractors, not our employees or agents. Holding the data described below does not make the Company the provider of a ride or responsible for what happens on one.',
    ],
  },
  {
    heading: 'Information we collect',
    paragraphs: [
      'To run the service we collect account and trip data, including:',
      'We also receive safety-related information you choose to send, such as an SOS event, a shared-trip link, a safety report, or a message to support. If you opt in to record audio or video, that recording stays on your device, as “Recordings” explains, unless you later choose to attach a copy to a report.',
    ],
    bullets: [
      'Account details: name, email, and authentication identifiers from Supabase Auth. A Clemson (@clemson.edu) email may unlock student pricing.',
      'Student verification markers such as student_verified_at when your Clemson email is confirmed.',
      'Trip details: pickup/dropoff labels and coordinates, scheduled time, fare amounts, status history, and driver assignment.',
      'Payment metadata from Stripe Checkout (we do not store full card numbers on Clemson RIDES servers).',
      'Optional profile fields you provide (phone, home/work labels) and device/session signals needed for realtime trip updates.',
      'Safety-tool events you start, including SOS, a call or text you place from the app, trip sharing, and emergency-contact labels you save for yourself.',
    ],
  },
  {
    heading: 'How we use information',
    paragraphs: [
      'We use this data to create accounts, apply student pricing when a Clemson email is used, match riders with drivers, process fare payments, show live trip status, calculate driver earnings from completed fares, prevent abuse, and improve reliability of the campus airport-ride experience. We also use it to review safety reports, to investigate suspected violations of our Terms, and to respond to lawful process. We do not sell your personal information.',
      'Safety and investigation use can include preserving trip status, location associated with a trip, SOS events, and the messages you send us, and looking at that material when a report, a payment dispute, or a legal request makes the review relevant. That work is an administrative function of the software operator. It is not live supervision of a ride, and it does not create a duty to prevent another person’s conduct.',
    ],
  },
  {
    heading: 'Sharing',
    paragraphs: [
      'We share data only as needed to operate the product: with Stripe for card payments, with Supabase for auth, database, and realtime features, and with the driver or rider assigned to your trip only to the extent “Names and phone numbers” allows. We share information with law enforcement, regulators, or other public authorities when we believe in good faith that the law requires it, that legal process such as a subpoena or court order compels it, or that disclosure may reduce an imminent risk of serious harm. Aggregated, non-identifying stats may be used for campus operations reporting.',
      'We may also share information with professional advisors, insurers, and payment partners when a claim, a dispute, or a legal hold makes that sharing necessary, and with a successor if the business that operates the Platform is transferred. We do not give your information to advertisers for their own marketing. Helping a law-enforcement agency does not promise a particular outcome and does not add a duty beyond what this policy states.',
    ],
  },
  {
    heading: 'Recordings',
    paragraphs: [
      'Riders who opt in to audio or video recording keep those recordings local, on their own device. The clip is not uploaded by the Platform, is not hosted by us, and is not reviewed by us unless the rider later chooses to provide a copy as part of a safety report or an investigation.',
      'Driver dashcam video and driver audio clips, when a driver uses those tools, are stored on the driver’s device. They are that driver’s records. The Company does not run a central recording archive and does not promise that a dashcam or an in-app recording was on, was saved, or will still exist after a trip.',
      'A recording control is optional, and the app shows when a clip is being made. Whether to record is your choice. If you voluntarily send us a file, we may keep it for the report or investigation it belongs to and may provide it to law enforcement when “Sharing” allows. Having a file you sent does not mean we recorded the ride, and it does not create a duty to record, to keep every file, or to stop harm.',
    ],
  },
  {
    heading: 'Names and phone numbers',
    paragraphs: [
      'Driver and rider names shown to the other party on a trip are first name only. We do not display a last name, a full legal name, or an email address to the person on the other side of a ride. Carpool and group screens follow the same first-name practice.',
      'Phone numbers are never shared between riders and drivers. A number you add to your account is used for that account, for support you start, and for safety tools you control, such as emergency contacts you save for yourself. It is not given to the other party, and ride chat is not a way to exchange personal phone numbers.',
      'Safety numbers shown in the app, including 911 and the Clemson Police number in the safety tools, are public emergency contacts. They are not another user’s private number. Trip sharing sends a live link to a person you pick. That link does not disclose the other party’s phone number.',
    ],
  },
  {
    heading: 'Retention & security',
    paragraphs: [
      'Trip and account records are retained while your account is active and for a reasonable period afterward for dispute resolution, accounting, and safety. We use industry-standard controls via our providers (encrypted transport, access-controlled databases). No method of transmission is 100% secure; please use a strong password.',
      'Safety reports, SOS records, and any clip you choose to send us may be kept for as long as we reasonably need them for an investigation, a legal hold, insurance, or a law-enforcement request, which can be longer than ordinary trip history. On-device recordings that you never send us are outside our retention because we do not have them. Keeping a record for safety is not an admission that we owed a duty to prevent the underlying event.',
    ],
  },
  {
    heading: 'Your choices',
    paragraphs: [
      'You may update profile details in Account, sign out at any time, and request deletion of your account/trip history by contacting Clemson RIDES support from Account. Marketing browse screens remain available without signup; booking and payment require a signed-in account.',
      'You may decline optional recording and you may choose not to share a trip link. Emergency tools, including SOS and call 911, remain available so you can use them if you want. Closing an account does not erase a safety record we must keep for a legal process, a chargeback, or an investigation already underway.',
    ],
  },
  {
    heading: 'Children',
    paragraphs: [
      'Clemson RIDES is intended for university students and adults. We do not knowingly collect personal information from children under 13.',
    ],
  },
  {
    heading: 'No duty from this policy',
    paragraphs: [
      'To the maximum extent permitted by applicable law, this Privacy Policy and the practices it describes do not create a duty of care, a duty to monitor, a duty to warn, or any liability for incidents, interactions, inappropriate behavior, illegal acts, sexual misconduct, harassment, abuse, assault, injury, or property damage or loss involving riders, drivers, or third parties, whether before, during, or after a ride. The Terms of Service — including the warranty disclaimer, the release, the damages limits, and binding individual arbitration — also govern disputes about privacy and safety data.',
      'We may update this policy. The “Last updated” date will change when we do, and continued use after that date is acceptance of the update. Every limit in this policy applies to the maximum extent permitted by applicable law. If a statute forbids a waiver of a privacy right, or forbids a limit on liability for gross negligence or willful misconduct, the statute controls for that point only and the rest of this policy stays in effect. Questions can be sent from Account → Support or by mail to Clemson RIDES, 101 North Main Street, Greenville, SC 29601.',
    ],
  },
]

export const TERMS_SECTIONS = [
  {
    heading: 'Agreement',
    paragraphs: [
      'By creating a Clemson RIDES account, requesting a ride, going online as a driver, or otherwise using the booking, payment, or driver features, you agree to these Terms of Service and to the Privacy Policy. If you do not agree, do not use those features. Guest browsing of marketing and schedule information is allowed without an account.',
      'These Terms are a contract between you and Clemson RIDES, whose mailing address is 101 North Main Street, Greenville, SC 29601. They bind riders, drivers, and anyone else who uses the Platform. You represent that you can form a contract and that you are using the Platform by your own choice.',
      'Read the sections on the technology-platform role, independent contractors, assumption of risk, disclaimers, limitation of liability, release, indemnification, safety cooperation, and arbitration. Those sections allocate risk and describe how a dispute is heard. Using the Platform after the “Last updated” date accepts the Terms then posted.',
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
      'Clemson RIDES connects student riders with drivers for scheduled campus-to-airport trips at published flat rates (for example GSP and CLT). Requesting a ride places a card hold for the estimated fare plus a buffer. The final fare is charged when the trip ends. Tips or adjustments may be handled as described in-app. Availability depends on online drivers and is not guaranteed for every requested time.',
      'What we offer in that sentence is software: a way to request, match, price, and pay. Any transportation that follows is performed by an independent driver under “Technology platform” and “Independent contractors.” A quote, a hold, or a match is not a promise by the Company that a vehicle will arrive or that a trip will be finished.',
    ],
  },
  {
    heading: 'Rider responsibilities',
    bullets: [
      'Be ready at the stated pickup location and time.',
      'Share accurate flight/schedule notes when relevant.',
      'Treat drivers and property respectfully; no illegal activity in vehicles.',
      'Cancel promptly if plans change. A card hold that is not captured is released. Captured fares follow the in-app and Stripe receipt terms.',
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
      'Card payments are processed by Stripe. The platform keeps 20% of rider charges (fares, wait fees, and cancellation fees) and the driver keeps 80%. After a driver taps Arrive there is a 3-minute grace at $0, then $1 per minute (rounded up) while the trip stays arrived. On a completed trip that wait fee is split 20% platform / 80% driver. From 5 minutes the driver may cancel; the rider owes the wait fee accrued so far, with the same 20/80 split. At 7 minutes the ride cancels automatically: the rider is charged $5 ($4 wait + $1 cancellation fee), the driver keeps $4, and the platform keeps $1. If a saved card cannot be charged, the fee is still owed and recorded as pending. Payout timing and tax reporting (if any) will be disclosed in driver onboarding or Account. Chargebacks or fraud may result in account suspension.',
    ],
  },
  {
    heading: 'Technology platform',
    paragraphs: [
      'Clemson RIDES is a technology platform that connects people who want a ride with independent drivers who choose to offer one. The Company is not a transportation carrier, a taxi company, a limousine service, or a common carrier, and it does not provide transportation services. We do not own, lease, or operate the vehicles used for trips, and we do not employ the people who drive them.',
      'Your use of the apps, websites, maps, fare quotes, and dispatch tools is a license to use software. It is not the sale of a ride by the Company. When a driver accepts a request, transportation that follows is supplied by that driver, in that driver’s vehicle, on that driver’s time. The Company does not control the manner or route of driving, does not ride along, and is not a party to the act of transporting someone.',
      'A logo, a campus color, an estimated arrival, or a status such as “arriving” does not make the Company the carrier and does not make a driver our employee or agent. Clemson University does not operate the Platform and is not responsible for trips. The word “Clemson” in the product name identifies the community the software is built around. It is not a statement of university sponsorship.',
    ],
  },
  {
    heading: 'Independent contractors',
    paragraphs: [
      'Drivers on the Platform are independent contractors. They are not employees, agents, partners, joint venturers, or representatives of Clemson RIDES. A driver chooses whether to open the app, whether to go online after approval, which requests to accept, and how to operate the driver’s own vehicle within the law.',
      'The Company does not pay a wage, does not assign a shift, and does not withhold payroll taxes from trip payouts except where a statute later requires a withholding we will describe in writing. Drivers supply their own licenses, vehicles, fuel, insurance, and tax filings. Letting a driver receive requests is permission to use software. It is not a public certification that the driver is safe, and it gives the driver no authority to speak for or bind the Company.',
      'Riders use a marketplace. They are not passengers of the Company. No rider, driver, airport, university, or other third party is a beneficiary of any promise that the Company will answer vicariously for someone else’s driving or personal conduct. Approved drivers also sign a separate contractor agreement. Where that agreement and these Terms both apply, the driver must meet both, and on any question of the Company’s liability the provision that limits that liability more tightly is the one that controls.',
    ],
  },
  {
    heading: 'Driver Agreement',
    paragraphs: [
      'Each driver who uses the Platform is an independent contractor. There is no employment, no agency, and no partnership between a driver and Clemson RIDES. A driver is solely responsible for the driver’s own conduct, for the vehicle the driver uses, for the insurance that covers that driving, and for compliance with traffic law, airport rules, campus rules, and every other legal duty that applies to the driver.',
      'The platform may hold a driver accountable for access to the software. Accountability can include a warning, a suspension, a deactivation, or forfeiture of incentives, and the Company may use any of those measures at its sole discretion. Those measures decide whether the driver may keep using the Platform. They are not wages, not employee discipline, and not an undertaking to supervise the driving.',
      'The platform shall never be held liable, to the fullest extent permitted by law, for any legal claim arising from a driver’s acts or omissions. That reaches claims by a rider, another driver, a pedestrian, an airport, a university, an insurer, or any other person, and it reaches injury, death, property damage or loss, harassment, and illegal conduct before, during, or after a ride. The limit applies to the maximum extent permitted by applicable law. It does not reach liability for gross negligence or willful misconduct, or any other liability, where a statute forbids the waiver.',
      'The driver indemnifies and defends the platform. A driver will defend, indemnify, and hold harmless Clemson RIDES and its owners, members, managers, officers, employees, agents, and affiliates from claims, losses, damages, fines, and reasonable attorney’s fees arising out of the driver’s driving, vehicle, insurance, conduct, or failure to follow the law or these Terms. The Company may direct the defense of a covered claim. This duty continues after access to the Platform ends.',
    ],
  },
  {
    heading: 'Assumption of risk',
    paragraphs: [
      'You use the service, and you take rides, at your own risk and by your own choice. Requesting a pickup, accepting a request, entering a vehicle, or staying in one is voluntary. You may decline a match, cancel under the product rules, or stop using the Platform. Riding in a private vehicle with another person carries risks we cannot remove, including traffic, weather, driver error, a mechanical problem, crime, and the way other people behave.',
      'You acknowledge that you have access to in-app safety features and that you decide whether to use them. Those features include the safety area in the app, SOS, call 911, a call to Clemson Police at the number the safety tools display, trip sharing by a live link, and safety numbers you save as emergency contacts. A feature’s presence gives you a way to ask for help. It does not mean staff are watching the ride, that someone from the Company will intervene, or that the Company has taken on your safety as its own obligation.',
      'You accept the risk of what can happen before a driver arrives, while you are together, and after you leave the vehicle, including when the app status has already changed. That includes inappropriate behavior and other personal conduct by a rider, a driver, or a third party. If you are in danger, contact emergency services directly. Do not wait on an in-app reply.',
    ],
  },
  {
    heading: 'Disclaimers',
    paragraphs: [
      'Rides are provided by independent drivers, not as a university-operated transit service. Clemson RIDES is a software marketplace and is not a common carrier. Transportation, when it happens, is performed only by the driver who accepts the request. The Company disclaims responsibility for the condition of a vehicle, the path a driver takes, and whether a driver or a rider follows the law.',
      'THE PLATFORM, THE APPS, THE WEBSITES, AND EVERY RELATED FEATURE ARE PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE FULLEST EXTENT PERMITTED BY LAW, THE COMPANY DISCLAIMS EVERY WARRANTY, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, AND NON-INFRINGEMENT, AND ANY WARRANTY THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE, OR FREE OF ERRORS. WE DO NOT WARRANT THAT A DRIVER WILL BE NEARBY, THAT AN ARRIVAL TIME OR A FARE WILL BE RIGHT, THAT A FLIGHT WILL BE MET, OR THAT A TRIP WILL BE SAFE OR COMPLETED.',
      'The Company is not responsible for incidents or interactions connected with the Platform or a ride. That responsibility is disclaimed for inappropriate behavior, illegal acts, sexual misconduct, harassment, abuse, assault, personal injury, and property damage or loss, whether the event is before, during, or after a ride, and whether the people involved are riders, drivers, or third parties. The disclaimer also reaches conduct off the Platform when it involves someone you met through a trip.',
      'Some places do not allow particular warranty disclaimers. Where that is so, the disclaimers in this section apply to the maximum extent permitted by applicable law, and any warranty a statute requires and does not let us disclaim is limited to the shortest duration and the narrowest scope that statute allows.',
    ],
  },
  {
    heading: 'Limitation of liability',
    paragraphs: [
      'To the maximum extent permitted by applicable law, the Company and its owners, members, managers, officers, employees, agents, and affiliates will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost data, missed flights, missed classes, emotional distress, or harm to reputation, whether the claim sounds in contract, tort, statute, or another theory, and whether or not we were told such damages might occur. This exclusion of consequential and punitive damages is intended to be as broad as a court will enforce.',
      'Our aggregate monetary responsibility for every claim arising out of these Terms, the Platform, or a ride, including a claim that is not validly released, will not exceed the greater of (a) the amount you paid through the Platform for the specific trip that gave rise to the claim or (b) one hundred U.S. dollars (US$100). If you are a driver, clause (a) means the platform fees the Company actually retained from your trips during the three months before the claim, and if there are no such fees the cap is US$100. The cap is a single ceiling for all related claims. It does not reset per person, per theory, or per incident.',
      'Those limits apply to injury, property damage or loss, and the conduct of riders, drivers, and third parties, before pickup, during the trip, and after drop-off. They still apply if a limited remedy fails of its essential purpose. They do not apply to liability that a statute says cannot be capped or waived, including liability for gross negligence or willful misconduct where the statute forbids a waiver. In that case the rest of this section continues to cover every claim the law does allow us to limit.',
    ],
  },
  {
    heading: 'Release of claims',
    paragraphs: [
      'To the maximum extent permitted by applicable law, you release and forever discharge Clemson RIDES and its owners, members, managers, officers, employees, agents, contractors, affiliates, and successors from claims, demands, and causes of action arising out of the Platform, a ride, or an interaction tied to a ride. The release includes claims you know about and, to the extent South Carolina law allows, claims you do not yet know about.',
      'The released subject matter includes personal injury, death, property damage, property loss, emotional distress, and money loss. It includes claims arising from inappropriate behavior, illegal acts, sexual misconduct, harassment, abuse, or assault. It includes acts and omissions of a rider, a driver, or a third party, and events before a ride, during it, and after it. You give up claims you might otherwise bring against the Company because of those events, except a claim a statute says you cannot give up.',
      'This release is a material reason the Platform is offered at all. If a decision-maker holds that one slice of the release cannot be enforced against one claim, every other part of the release and every other part of these Terms stays in force. You are not relying on any statement that the Company supervises drivers or promises a safe trip.',
    ],
  },
  {
    heading: 'Indemnification',
    paragraphs: [
      'You will defend, indemnify, and hold harmless Clemson RIDES and its owners, members, managers, officers, employees, agents, affiliates, and service providers from any claim, demand, loss, liability, fine, penalty, damage, cost, and reasonable attorney’s fee arising out of or related to (a) your use of the Platform, (b) your conduct before, during, or after a ride, (c) your interaction with a rider, a driver, or a third party, (d) your violation of law or of these Terms, (e) injury, death, or property damage or loss connected with a trip you requested or drove, and (f) a dispute between you and another user.',
      'We may choose counsel on a covered claim at your expense, or we may require a defense by counsel we reasonably accept. You will not settle a matter that admits fault by the Company or that puts an obligation on the Company unless we agree in writing first. This indemnity continues after you close your account. It is meant to reach as far as the law will let an indemnity by a user of software reach.',
      'You do not have to indemnify the Company for the Company’s own gross negligence or willful misconduct, or for a liability a statute forbids a contract to shift onto you. If a consumer statute trims an indemnity, this section is enforced only to the maximum extent permitted by applicable law and the trimmed piece is handled under “Governing law.”',
    ],
  },
  {
    heading: 'Safety cooperation',
    paragraphs: [
      'The Company will assist with a safety report you submit in the app or through support, in the practical sense of receiving it, preserving related account and trip records, and looking at what you sent. We will cooperate with law enforcement when we receive valid legal process or when we believe in good faith that sharing information may address an imminent risk of harm. That cooperation can include providing records we hold. It is not a commitment to investigate every report to a set depth or on a set clock.',
      'We may suspend or deactivate a rider or a driver who breaks these Terms, the in-app rules, or the law, or who presents a safety concern. We may do that at our sole discretion, with or without advance notice, and we may refuse further use of the Platform on the same basis. Where it is practical and lawful, we will indicate that access has ended. You may leave the Platform whenever you want.',
      'Help with a report, cooperation with authorities, a rating, a suspension, a deactivation, and the presence of SOS, call 911, trip sharing, or any other safety tool do not create a duty of care, a duty to protect, a duty to warn, or any other duty or liability. The Company does not undertake to police private behavior. Nothing in this section makes us a guarantor of anyone’s safety or a supervisor of the people who use the software.',
    ],
  },
  {
    heading: 'Dispute resolution',
    paragraphs: [
      'Before starting a formal claim, you and the Company will try to work the dispute out informally. Send a notice that describes the dispute and the relief you want to the mailing address in “Contact,” or we will send notice to the email on your account. If it is still open thirty (30) days after the notice is received, either party may begin arbitration as this section provides. You do not have to finish that informal step before a small-claims case that this section allows.',
      'Except for an individual claim that belongs in small-claims court, any dispute arising out of or relating to these Terms, the Privacy Policy, the Platform, or a ride will be resolved by binding individual arbitration. The American Arbitration Association will administer it under its Consumer Arbitration Rules when those rules fit the claim, and otherwise under its Commercial Arbitration Rules. There will be one arbitrator. The seat is Greenville, South Carolina, unless the arbitrator picks another place in South Carolina that is fair to both sides. The Federal Arbitration Act governs this arbitration agreement. A court with jurisdiction may enter judgment on the award.',
      'YOU AND THE COMPANY EACH WAIVE A JURY TRIAL AND WAIVE ANY CLASS ACTION, CLASS ARBITRATION, COLLECTIVE ACTION, OR REPRESENTATIVE ACTION. This class-action waiver means each party brings claims only as an individual, and the arbitrator may award relief only to the individual who brought the claim and only to the extent needed to resolve that one claim. Either party may instead bring an individual action in a small-claims court of competent jurisdiction in South Carolina, which is the small-claims carve-out, so long as the case stays in that court and is not joined with anyone else’s claim.',
      'Either party may ask a court of competent jurisdiction in South Carolina for temporary injunctive relief to protect confidential information, intellectual property, or safety while arbitration goes forward. If the class-action waiver is held unenforceable for a particular claim, that claim proceeds in court and the agreement to arbitrate still covers every other claim. You may reject arbitration only by mailing a signed opt-out, with your name and account email, to the address in “Contact” within thirty (30) days after you first accept these Terms. Rejecting arbitration leaves every other section in place.',
    ],
  },
  {
    heading: 'Governing law',
    paragraphs: [
      'South Carolina law governs these Terms and any dispute that is not arbitrated, without regard to conflict-of-law rules that would pick another state’s law. The Federal Arbitration Act governs the arbitration agreement. Subject to that agreement, the state courts and the federal courts located in South Carolina are the exclusive venues for a court case, and you consent to personal jurisdiction in those courts.',
      'If any provision of these Terms is held invalid or unenforceable, it will be modified to the minimum extent required to make it valid, or severed if it cannot be modified, and the remaining provisions will continue in full force. This severability rule is material. Failing to enforce a term once does not waive the right to enforce it later. A heading is only a label. “Including” means “including without limitation.”',
      'These Terms do not waive liability for gross negligence or willful misconduct, or any other liability, where a statute forbids the waiver. Every disclaimer, release, indemnity, exclusion of damages, and cap on damages applies to the maximum extent permitted by applicable law and is enforced to that extent rather than thrown out. If these Terms ever conflict with a mandatory right under a statute that validly applies to you, the statute controls for that right alone.',
    ],
  },
  {
    heading: 'Termination',
    paragraphs: [
      'We may suspend or terminate accounts that abuse the service, falsify Clemson affiliation, harass others, or violate these Terms, including under “Safety cooperation.” You may stop using the service at any time and may request account deletion from Account. Closing an account does not undo a release, an indemnity, a limitation of liability, or an arbitration agreement that already covers events from when you used the Platform.',
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
      'For terms or privacy questions related to Clemson RIDES campus airport rides, use Account → Support or your campus program administrator. Notices required by these Terms, including a notice that starts the informal dispute step and an arbitration opt-out, must be mailed to Clemson RIDES, 101 North Main Street, Greenville, SC 29601. A mailed notice is effective when we receive it.',
    ],
  },
]
