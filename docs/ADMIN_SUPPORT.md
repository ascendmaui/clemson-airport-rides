# Admin and support

Clemson orange `#F56600`, purple `#522D80`. The dashboard is the web app at [https://clemsonrides.com/admin](https://clemsonrides.com/admin). `#/admin` still opens the same screen. It is not a separate site.

## Sign in as admin

1. Open [https://clemsonrides.com/admin](https://clemsonrides.com/admin) (or `npm run dev`, then `/admin`).
2. Sign in with Google. The return lands back on `/admin`.
3. The server allows the request when `loadStaffAccess` says the account is an admin. That covers the owner roster (`johnmatveyev@gmail.com`, `ascendmaui@gmail.com`, `jmat2019@icloud.com`), `admin_users`, and `ADMIN_EMAILS`.

John (`johnmatveyev@gmail.com`) is on the owner roster and in `admin_users`. After Google sign-in, the To-do tab is the first screen. The same Google account in the rider app and the driver app shows an Admin row under Account and Settings, with the waiting count. The row stays hidden for every other account because it renders only after `GET /api/admin?action=inbox` returns 200. That row opens the native to-do list. Open web admin uses the in-app browser at `https://clemsonrides.com/admin`.

`john@gmail.com` and `johnmatveev@gmail.com` are not admin addresses. Do not add them to `admin_users`, `ADMIN_EMAILS`, or `ADMIN_NOTIFY_EMAIL`. Owner accounts that should keep access are `johnmatveyev@gmail.com` and `ascendmaui@gmail.com`. `jmat2019@icloud.com` is an existing admin profile.

Apply `supabase/migrations/20261005060000_admin_roster_and_saved_places.sql` on databases that already seeded the unknown addresses. That migration deletes those `admin_users` rows, records the owner rows, and sets `ascendmaui@gmail.com` to admin. `public.is_admin()` stays false for the unknown addresses even if a profile flag is set. There is no `USING (true)` policy.

The admin screen shown to other accounts says "Admin access required" and does not list addresses.

Support-only rows in `admin_users.access_role = 'support'` can read the ticket inbox. They cannot approve drivers or open the PII admin views. `SUPPORT_ADMIN_EMAILS` adds support readers. It does not grant admin, and the unknown addresses above are ignored if they appear there.

Application notices go only to `ADMIN_NOTIFY_EMAIL`. If that variable is empty, nothing is emailed.

No production secrets are in the repo. Server routes need `SUPABASE_SERVICE_ROLE_KEY` on Vercel. Optional email uses `RESEND_API_KEY` and `RESEND_FROM`. Leave them empty until a verified domain exists. The in-app queue still works.

## Dashboard

`/admin` tabs. The web Account screen also shows Admin dashboard, with the waiting count, after the same server check.

| Tab | What an admin sees |
| --- | --- |
| To-do | Counts and the oldest urgent items: AI-flagged document reviews (`pending` and `manual-review`), profile-photo review, driver approvals, pending applicants missing background attestation, inspections due or overdue, open lost items, flagged trip-chat reports, payout and W-9 problems, failed Stripe holds, and stuck trips. Each row shows age. Actions call the existing admin endpoints. |
| Notifications | New driver applications and escalated tickets |
| Applicants | Documents, answers, status. Approve or reject. Message. Request more information |
| People | Rider and driver profiles |
| Trips | Recent trips |
| Support | Ticket inbox |

Approve sets `driver_applications.onboarding_status = approved` and `profiles.role = driver` (admins stay admin). That is the gate for accepting rides. Reject takes the driver offline.

Applicant messages and info requests show on the web driver application and in the driver app review step (`/onboarding`). If Resend is unset, the API stores an email stub and the applicant still sees the request in the app.

A new `pending_review` application inserts `admin_notifications` (kind `driver_application`).

Driver profile photos that are not auto-approved show in the To-do list and in the same Driver review screen, under **Profile photos**: [https://clemsonrides.com/admin?tab=applications](https://clemsonrides.com/admin?tab=applications). Photos already stored as `pending_manual_review` are in that list too. Approve photo or Reject photo is on that screen. Rejection is admin-only. The notification (kind `other`, entity `driver_profile_photo`) opens this tab and includes the reason. A clear match sets the license row's `match_status` to `matched`. The driver app reads `review_status` and shows Approved when it is `approved`.

## Support bot

Tickets use `open`, `bot_handling`, `waiting_user`, `escalated`, and `resolved`.

Filing a confirmed ticket inserts it as `bot_handling`, then `server/supportBot.js` replies:

- Account, payments how-to, ride status, and driver-application status can resolve or ask one follow-up (`waiting_user`).
- The bot escalates when the user asks for a person, the intent is unknown, confidence is under 0.75, or it cannot finish the job (refunds, safety, ride disputes, unexplained bugs).
- Escalation writes `admin_notifications` (kind `support_escalation`) and sets status `escalated`. A later user reply on an escalated ticket stays with the admin.

Admins reply from `#/admin?tab=support`. Riders and drivers use Account → Support.
