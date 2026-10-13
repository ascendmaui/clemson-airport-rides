# Background check attestation

Driver onboarding does **not** run a background check. The employment step records a three-part attestation. Admins see one of three statuses. None of them means the person was screened by a vendor.

| Status | Meaning |
| --- | --- |
| `pending` | The attestation is unfinished. A lone consent checkbox stays here. |
| `authorized` | The applicant entered a legal name, answered every disclosure **no**, and signed the authorization. Consent is on file. No vendor was contacted. |
| `needs_review` | The applicant signed and answered **yes** to at least one disclosure. An admin must acknowledge that disclosure before approve is enabled. |

There is no `clear`, `passed`, or `completed` value. The database constraint rejects anything else. A trigger recomputes the status from the disclosure answers so the applicant cannot mark themselves authorized after a yes answer.

Approve stays off while the status is `pending`. Approve stays off for `needs_review` until the admin checks that they reviewed the disclosure. That checkbox is not a vendor clear.

Apply `supabase/migrations/20261007120000_background_check_attestation.sql` on Supabase before using this in production. Until that migration is applied, a disclosure that needs review cannot be saved, because storing only the old consent timestamp would hide it.

## What a real vendor hook needs

A Checkr-style integration is a separate project. It needs credentials this repo does not have, and it must not reuse the attestation status as the result.

1. **Secrets, not in the repo.** `CHECKR_API_KEY` and `CHECKR_WEBHOOK_SECRET`. A package slug such as `CHECKR_PACKAGE` for the criminal + motor-vehicle package you actually buy. Use the host's environment variables. Do not commit them.
2. **Candidate create.** After the attestation is `authorized` or an admin has acknowledged `needs_review`, a server route creates a vendor candidate with legal name, email, date of birth, and the screening identifier the vendor requires. The W-9 taxpayer number is a tax record. Do not copy it into the screening request unless counsel says that consent covers it, and do not log it.
3. **Invitation or report order.** Store `background_vendor`, `background_vendor_candidate_id`, `background_vendor_report_id`, and `background_vendor_status` on `driver_applications`. Those columns do not exist yet. Add them in a new migration when the vendor is chosen.
4. **Webhook.** Verify `CHECKR_WEBHOOK_SECRET` before trusting `report.completed` or the vendor's adjudication event. Write the vendor status (`pending`, `clear`, `consider`, `suspended`, or whatever that vendor documents) only to `background_vendor_status`. Leave `background_check_status` as the attestation.
5. **Admin display.** Show both lines: attestation status, and vendor status. Until the webhook writes a result, vendor status is empty. Do not copy `clear` into `background_check_status`, and do not enable approve from a vendor event that was not verified.
6. **Failure.** If the vendor call fails, leave the attestation as it was and surface the error to the admin. Do not mark the check authorized or clear to unblock the driver.

Checkr is one option. The same shape fits another screening API: server-only secret, candidate id, verified webhook, and a vendor status column that this build does not write.
