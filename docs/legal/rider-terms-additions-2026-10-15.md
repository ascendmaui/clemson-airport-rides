# DRAFT – rider Terms additions, not in effect on main

Branch: `cursor/liability-legal-copy-eb21` (the PR #485 branch). PR #485 itself was merged on 2026-10-13, so these commits are **not** part of any open PR and **not** live. `main`'s Terms of Service are unchanged.

## What was added

Only additions. Articles 1–23 of `TERMS_SECTIONS` in `shared/legalCopy.js` are byte-for-byte unchanged, as are `PRIVACY_SECTIONS` and `LEGAL_UPDATED`. Seven articles were appended:

| Article | Content |
| --- | --- |
| 24. Supplemental Protective Terms: Scope and Precedence | Articles 24–30 supplement, not replace; "to the fullest extent permitted by applicable law" on each; **precedence: the provision more protective of Clemson Rides controls** (an unenforceable one does not count); definitions of Company Parties and Covered Matter (any and all matters, any time, online/offline/en route, relating to Clemson Rides, the app and website, its people, drivers, riders, third parties, any dispatched ride) |
| 25. Dispatch Platform and Independent Drivers | Technology and dispatch platform connecting riders with independent-contractor drivers; not a carrier, not the drivers' employer; drivers provide the transportation; separate rider–driver transaction; Clemson Rides collects the fare as the driver's limited payment collection agent; safety features are not evidence of agency or control; capitalized "entire risk remains with you" and algorithm/location disclaimer |
| 26. Supplemental Assumption of Risk | Capitalized express assumption of all risks, known and unknown, any time; includes Company Parties' negligence and **gross negligence and any other conduct**, to the fullest extent permitted |
| 27. Supplemental Release, Unknown Claims, and Covenant Not to Sue | Capitalized universal release binding heirs and guests; includes negligence, **gross negligence and any other claim**, narrowed only as far as law requires; unknown-claims waiver; covenant not to sue; release does not cover claims against the driver personally or insurers |
| 28. Supplemental Indemnity and Damages Limits | Rider defend/indemnify/hold harmless, applying regardless of the indemnitee's negligence; consent to settle; capitalized consequential-damages exclusion; **cap = greater of US$100 or amounts paid in the prior 12 months** (with Article 14's lower cap controlling under precedence) |
| 29. Supplemental Dispute Resolution Terms | SC UAA fallback if the FAA does not apply; class waiver non-severable from arbitration, court decides validity, severed claims stayed; Company pays arbitration fees above a court filing fee; limitations tolled during informal notice; **no shortened limitations period**; heirs and guests bound; no retaliation for opt-out |
| 30. Supplemental Acknowledgment, Changes, Severability, and Survival | Affirmative re-acceptance for material changes to the protective articles; reform-not-strike severability that substitutes a valid term of similar effect; survival; capitalized acknowledgment (read, understood, took time to consider, could consult a lawyer, knowingly gives up rights) |

Internal `LAWYER REVIEW` notes are JavaScript comments next to each article and are not shown to riders. Test updated: `packages/rides-native/legalCopy.test.js` now expects 30 Terms articles and the seven new headings.

## Conflicts with existing text (left unedited)

| New | Existing | Conflict |
| --- | --- | --- |
| 26.2, 27.2 include gross negligence | 13 (para. 5), 14 (para. 3), 15 (para. 3), 16 (para. 3), 19.1, 11.6 | Existing articles carve out gross negligence / willful misconduct where a statute forbids the waiver; Article 16 says riders need not indemnify the Company's gross negligence |
| 28.3 cap (12-month spend) | 14 (para. 2) cap (trip amount or US$100) | Different caps; under 24.2 the lower Article 14 cap controls |
| 28.1 indemnity regardless of negligence | 16 | 16 excludes the Company's gross negligence |
| 30.1 affirmative re-acceptance | 22 (continued use is acceptance) | Additional step, not a replacement |
| 30.2 reformation | 20.1 blue-pencil | Compatible; 30.2 adds "valid term of similar effect" |
| 24.2 precedence | 9 (para. 3), 20.3 ("tighter limit controls") | Compatible in direction; broader in scope |

## Lawyer review needed (rider additions)

| # | Item |
| --- | --- |
| R-1 | **SC gross-negligence limit.** SC courts generally will not enforce a release, assumption of risk, or indemnity covering gross negligence, recklessness, or intentional conduct. John asked that Articles 26–28 include it "to the fullest extent permitted by applicable law." Including it may risk the **entire** clause, not just that part. |
| R-2 | **Overbreadth.** An overly broad or one-sided waiver can be thrown out entirely rather than narrowed (*Huskins v. Mungo Homes*, S.C. 2024, refused to sever an unlawful term from an adhesion contract). Counsel must confirm the scope of the universal "Covered Matter" definition. |
| R-3 | **Precedence rule.** "More protective for Clemson Rides controls" and the conflicts table above; a one-sided conflict rule can support unconscionability. |
| R-4 | **SC TNC Act duties vs dispatch-only framing** (S.C. Code Ann. §§ 58-23-1610 et seq.), including the payment-collection-agent framing. |
| R-5 | **Consumer-protection limits** on waivers, releases, indemnity, and caps in consumer adhesion contracts (SC Unfair Trade Practices Act, unconscionability, express-negligence rule for indemnity). |
| R-6 | Release and arbitration binding **heirs and guests** who did not accept the Terms. |
| R-7 | **Cap amount**: Article 28.3 (US$100 or 12 months) vs Article 14 (trip amount or US$100). |
| R-8 | **Arbitration and class waiver**: SC UAA fallback, § 15-48-10(a) first-page notice (the Terms have no first-page arbitration notice today), delegation, batching (Section 18.4), fees, non-severable class waiver. A 1-year claims deadline was deliberately **not** added (S.C. Code Ann. § 15-3-140; *Huskins*). |
| R-9 | **Whether existing riders must re-accept.** The web "agree" button stores `LEGAL_UPDATED` in sessionStorage only, so there is no durable per-rider acceptance record; `LEGAL_UPDATED` was not changed. The driver clickwrap also displays the full Terms, so drivers would see Articles 24–30; its version (`driver-clickwrap-2026-10-13-r5`) was not bumped. |
