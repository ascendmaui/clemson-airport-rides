# DRAFT – not in effect, not wired into the app

# Driver agreement draft 2026-10-15: change summary

Compares the draft in [`driver-agreement-draft-2026-10-15.md`](./driver-agreement-draft-2026-10-15.md)
with the live signed agreement `ic-agreement-2026-10-05`. The live text, its version, its
hash, and all app code are unchanged.

## Sources reread

| Text | Path |
| --- | --- |
| Live signed contractor agreement (version `ic-agreement-2026-10-05`, 33 sections) | `shared/icAgreement.js` |
| DB copy and SHA-256 of that version | `supabase/migrations/20261005090000_ic_agreement_version_row.sql` (`public.driver_agreement_versions`) |
| Signing function aligned to that version | `supabase/migrations/20261013230000_align_sign_driver_agreement_version.sql`, `supabase/migrations/20261005080000_prefilled_agreement_sign.sql` |
| Signing flow and stored copy | `shared/agreementSign.js`, `shared/agreementPrefill.js`, `server/agreementHttp.js`, `server/agreementMail.js`, `server/agreementPacket.js`, `src/screens/SignAgreement.jsx`, `src/components/SignedAgreementCopy.jsx` |
| Rider Terms of Service (incl. Article 10 "Driver Agreement" and Article 11 SC TNC compliance) and Privacy Policy | `shared/legalCopy.js` (re-exported by `packages/rides-native/legalCopy.js`; rendered by `src/screens/LegalPages.jsx`, `apps/rider/app/legal.tsx`) |
| Driver clickwrap (version `driver-clickwrap-2026-10-13-r5`) | `shared/driverClickwrap.js`, `packages/rides-native/DriverClickwrap.jsx`, `packages/rides-native/driverClickwrapClient.js`, `apps/driver/components/DriverAgreementPrompt.tsx` |
| Background-check attestation | `supabase/migrations/20261007120000_background_check_attestation.sql`, `docs/BACKGROUND_CHECK.md` |
| Card hold model (replaces deposit) | `docs/FARE_AUTHORIZATION.md` |
| Ride types, Extra Comfort, Carpool 50% | `shared/rideOptions.js`, `shared/copy/rideTypes.js`, `src/lib/fareRates.js` (`CARPOOL_SEAT_FRACTION_BPS = 5000`) |
| Payouts and cash-out | `server/payouts.js`, `server/endpoints/driverPayouts.js`, `server/endpoints/driverCashout.js`, `shared/cashout.js` |
| Pickup (trip) code | `shared/pickupBeacon.js` |
| Rider/driver privacy (first names, no phone sharing) | `shared/riderDriverPrivacy.js`, `server/privacyName.js` |

There was no `docs/legal/` or `legal/` folder before this draft.

## Section-by-section: old vs new

| Topic | Old (`ic-agreement-2026-10-05`) | New draft |
| --- | --- | --- |
| Name | Old all-caps brand name and "Operator" | **Clemson Rides** only, with 101 North Main Street, Greenville, SC 29601 |
| Up-front notices | None | First-page underlined-caps arbitration notice (SC § 15-48-10) and a waiver notice |
| Dispatch only (new §1) | "Technology intermediary, not a carrier" buried in definitions (§2, §4) | **Prominent §1 at the top:** dispatch service and technology platform only; not a transportation carrier; does not provide transportation; driver provides the transportation; no warranties; statutory duties still met; no university affiliation |
| Contractor status (§4) | §3–4: contractor, no control, other platforms allowed, no benefits, 1099 | Kept and strengthened: driver chooses **if, when, where, how long**, and whether to accept; no employment/partnership/JV/franchise/agency; no authority to bind; no right to control manner or means; free to work for other platforms even while online; taxes/W-9/1099; no benefits; **waiver of employee-benefit claims to the extent permitted**; classification cooperation/indemnity |
| Vehicle (§5) | §7 "Contractor bears all costs" | Driver has **sole responsibility and assumes all risk** for vehicle condition, maintenance, repairs, inspections, cleanliness, registration, fuel, fines, tickets, tolls, at own expense; lien/lease notice; no Company certification |
| Insurance (§6) | §11: personal policy, $100k/$300k/$100k "placeholders", lapse = deactivation | Personal **plus rideshare/TNC coverage for every period of app use, app-on through drop-off**; **primary** as to driver's operations; proof on request; notice of lapse; **stop driving immediately during any lapse**; amounts left as **[$___] placeholders**; Company CGL-only statement carried over from Terms |
| Legal compliance (§7) | Scattered (§5, §32) | One section: licensing, registration, SC TNC rules, traffic and distracted-driving law, airport/campus rules, taxes |
| Background checks (§8) | §14: vague "vendor later / TODO" wording | Describes the actual three-part attestation and the pending / authorized / needs-review statuses, and states none is a vendor clear; SC § 58-23-1650 disqualifiers |
| Vehicle standards (§9) | §15 | Kept (documents, manual license review, seatbelts, audits) |
| Ride types (§10) | Not covered | **Standard, Wait & Save, Extra Comfort, Carpool**; Extra Comfort only for vehicles listed with the comfort service class; **Carpool = 50% of Standard per seat** |
| Rider payment (§11) | §6: **deposit of ~25%** before/during trip, remainder at completion | **Deposit removed.** Card **authorization hold** at booking (scheduled: when released to drivers), **captured at or after completion**, **released if cancelled per policy**; failed capture may delay pay; no cash |
| Earnings and payouts (§12) | §6: 80/20 split stated in the agreement; Stripe Connect payouts on a schedule | Earnings per the fee disclosed in the app and Terms (no new fee terms); **Stripe onboarding required**; **payouts reviewed and approved by an admin before going to the driver's connected Stripe account**; **cash-out and tips follow the same approval**; reversals and setoff kept |
| Conduct, safety, trip codes (§13) | §16, §26, §28, §32 | Consolidated; adds the **pickup code** check; zero tolerance, nondiscrimination, service animals, harassment, crash steps, evidence preservation, lost and found, cancellations |
| Ratings, deactivation (§14) | §17 | Kept, no new policy |
| Non-solicitation, confidentiality (§15) | §18 (12-month/6-month non-solicit plus limited non-compete), §19, §20 | Six-month post-access rider non-solicit, confidentiality, non-disparagement kept; **limited non-compete dropped** (flagged L-15) |
| Privacy and location (§16) | §13 | Kept and aligned with Privacy Policy (first names only, no phone sharing, no sale, 3-year TNC retention) |
| Assumption of risk (§17) | §8 combined with waiver | **Separate, conspicuous, initialed** section; express assumption of all risks, known and unknown, **at any time (online, offline, en route, before/during/after rides)**, including ordinary negligence where enforceable |
| Release and waiver (§18) | §8: release of Company, gross negligence carve-out | **Universal scope:** any and all claims of any kind relating in any way to Clemson Rides, its platform/app/website, owners, officers, employees, contractors, affiliates, agents, any rider, any third party, and any dispatched ride; includes ordinary negligence where enforceable; carve-outs for gross negligence/intentional misconduct, statutory duties, earned pay, and direct claims against riders/insurers; initialed |
| Unknown claims (§19) | One sentence in §8 | **Separate express unknown-claims waiver**, initialed |
| Covenant not to sue (§20) | None | **New**, with fee-shifting only for released claims; initialed |
| Disclaimers (§21) | §10 "provided as available" | **Full AS-IS / AS-AVAILABLE** and implied-warranty disclaimer (merchantability, fitness, title, non-infringement), initialed |
| Limitation of liability (§22) | §10: no consequential damages; cap US$100 or 3 months of fees | Consequential-damages exclusion kept; cap now **[$___] placeholder** and universal scope; carve-outs for gross negligence, statutory duties, earned pay; initialed |
| Indemnity (§23) | §9: broad defend/indemnify | Kept and extended to affiliates, officers, directors, employees, contractors, and agents; online/offline/en route; insurance failures; carve-out for Company's own gross negligence; initialed |
| Survival (§26) | §21 list | Expanded to every waiver section |
| Arbitration (§27) | §22: AAA, Greenville seat, class waiver | Kept; adds jury waiver, mass-arbitration/delegation by reference to the Terms, 30-day opt-out (matches Terms) |
| Governing law and venue (§28) | §23: SC law, Pickens/Anderson County | SC law; **Greenville County** to match Terms and business address (flagged L-9) |
| Severability (§29) | §24: modify to minimum extent | **Reform/narrow rather than strike**, applied clause-by-clause and claim-category-by-claim-category |
| Electronic signature (§31) | §25, §33 | Kept; adds **initials boxes** for §§17–23 and a capitalized acknowledgment |
| Removed | Detailed tax prose (§27), records (§29), events/airports prose (§32), injunctive relief (§31) | Condensed into §§4, 7, 12, 13, 15; no business terms added |
| Lawyer review | One-line "template" note | Inline **[LAWYER REVIEW]** callouts plus a 19-item **Lawyer review needed** table |

## Revisions during drafting (John, Oct 15, 8:16–8:18 AM ET)

1. **Base request:** contractor status, release/waiver/indemnity, assumption of risk, deposit replaced with card hold, admin-approved Stripe payouts, keep all other current terms.
2. **Added terms (8:17 AM):** driver works on own terms (if/when/where/how long/accept); own insurance including rideshare/TNC from app-on through drop-off with proof; sole responsibility for legal compliance; sole responsibility for the vehicle at own expense; prominent dispatch-only/not-a-carrier clause near the top. New lawyer flags L-6 (dispatch-only vs TNC statute) and L-7 (SC insurance minimums).
3. **Maximum-protection pass (8:17 AM):** "to the fullest extent permitted by applicable law" on each clause; no employment/partnership/JV/franchise/agency; no authority to bind; no control of manner or means; benefit-claim waiver; primary coverage, lapse notice, and stop-driving rule; vehicle assumption of risk incl. fines/tickets/tolls; AS-IS/AS-AVAILABLE disclaimers; covenant not to sue; consequential-damages exclusion and bracketed cap; survival; reform-not-strike severability; capitals and initials boxes. No new fees, commissions, or deactivation policies.
4. **Universal-scope pass (8:18 AM):** release, waiver, assumption of risk, indemnity, cap, and covenant cover any and all claims, known or unknown, at any time (online, offline, en route, before/during/after rides), relating to the Company and its people, any rider, any third party, and any dispatched ride; explicit unknown-claims waiver. New lawyer flag **L-12**: overly broad or one-sided waivers risk being found unconscionable or against public policy in SC, which could void the whole clause — counsel to confirm scope.

## Revision 2026-10-15, ~8:40 AM ET: Uber/Lyft research pass and final decisions

Research: [`uber-lyft-terms-research-2026-10-15.md`](./uber-lyft-terms-research-2026-10-15.md). Decisions were made for the most protection likely to survive a court challenge, using mainstream rideshare defaults.

| Section | Change |
| --- | --- |
| §4.1, §4.3 | Business-to-business framing (driver engages the Platform), relationship re-confirmed at each login, no shared profit or loss; safety features and standards are not evidence of control or agency; no branding or uniform requirement except as law requires |
| §6.1 | Insurance minimums filled from the current rider Terms ($50k/$100k/$50k online; $1M on trip; UM), "or higher amounts law requires" |
| §6.3, §6.6 | Proof of premium and renewal copies; Company coverage, if any, may change |
| §11.6 | New: separate driver–rider transaction; Company collects fares as limited payment collection agent |
| §12.3 | Payout states (pending / approved and sent / rejected) per PR #554 |
| §21.3 | Entire risk remains with driver; algorithm and location-data disclaimers; no rider screening warranty |
| §22.1–22.2 | Express-negligence wording; cap = greater of US$100 or 12 months of platform fees |
| §23.1 | Indemnity expressly covers the Company Parties' ordinary negligence (SC express-negligence rule) |
| §27 | Rewritten: 30-day informal notice that tolls limitations; AAA Commercial rules (Employment rules for misclassification claims); FAA with SC UAA fallback; delegation except class waiver; non-severable class waiver decided by courts; mass-arbitration batching; Company pays fees above a court filing fee; workers' comp/unemployment and small-claims carve-outs; jury waiver; heirs and service providers bound; no shortened deadline; 30-day opt-out with no retaliation |
| §29.1 | Reformation replaces an invalid term with a valid one of similar effect |
| §30.2 | Material changes require affirmative re-acceptance; each version restarts the opt-out window |
| Lawyer list | L-4, L-7, L-8, L-13 updated; L-20 (no shortened deadline), L-21 (market techniques; Uber takes no driver indemnity), L-22 (re-acceptance flow) added |
