# Admin and support

Clemson orange `#F56600`, purple `#522D80`. The dashboard is the web app at `#/admin` (Account → Admin dashboard). It is not a separate site.

## Sign in as admin

1. Open the live site or `npm run dev`, then `#/sign-in`.
2. Sign in with an account whose `profiles.role` is `admin` or `ops`, or whose `profiles.is_admin` is true. Server routes also honor `ADMIN_EMAILS`.
3. Open `#/admin`.

`john@gmail.com` and `johnmatveev@gmail.com` are not admin addresses. Do not add them to `admin_users`, `ADMIN_EMAILS`, or `ADMIN_NOTIFY_EMAIL`. Owner accounts that should keep access are `johnmatveyev@gmail.com` and `ascendmaui@gmail.com`. `jmat2019@icloud.com` is an existing admin profile.

Apply `supabase/migrations/20261005060000_admin_roster_and_saved_places.sql` on databases that already seeded the unknown addresses. That migration deletes those `admin_users` rows, records the owner rows, and sets `ascendmaui@gmail.com` to admin. `public.is_admin()` stays false for the unknown addresses even if a profile flag is set. There is no `USING (true)` policy.

The admin screen shown to other accounts says "Admin access required" and does not list addresses.

Support-only rows in `admin_users.access_role = 'support'` can read the ticket inbox. They cannot approve drivers or open the PII admin views. `SUPPORT_ADMIN_EMAILS` adds support readers. It does not grant admin, and the unknown addresses above are ignored if they appear there.

Application notices go only to `ADMIN_NOTIFY_EMAIL`. If that variable is empty, nothing is emailed.

No production secrets are in the repo. Server routes need `SUPABASE_SERVICE_ROLE_KEY` on Vercel. Optional email uses `RESEND_API_KEY` and `RESEND_FROM`. Leave them empty until a verified domain exists. The in-app queue still works.

## Dashboard

`#/admin` tabs:

| Tab | What an admin sees |
| --- | --- |
| Notifications | New driver applications and escalated tickets |
| Applicants | Documents, answers, status. Approve or reject. Message. Request more information |
| People | Rider and driver profiles |
| Trips | Recent trips |
| Support | Ticket inbox |

Approve sets `driver_applications.onboarding_status = approved` and `profiles.role = driver` (admins stay admin). That is the gate for accepting rides. Reject takes the driver offline.

Applicant messages and info requests show on the web driver application and in the driver app review step (`/onboarding`). If Resend is unset, the API stores an email stub and the applicant still sees the request in the app.

A new `pending_review` application inserts `admin_notifications` (kind `driver_application`).

## Support bot

Tickets use `open`, `bot_handling`, `waiting_user`, `escalated`, and `resolved`.

Filing a confirmed ticket inserts it as `bot_handling`, then `server/supportBot.js` replies:

- Account, payments how-to, ride status, and driver-application status can resolve or ask one follow-up (`waiting_user`).
- The bot escalates when the user asks for a person, the intent is unknown, confidence is under 0.75, or it cannot finish the job (refunds, safety, ride disputes, unexplained bugs).
- Escalation writes `admin_notifications` (kind `support_escalation`) and sets status `escalated`. A later user reply on an escalated ticket stays with the admin.

Admins reply from `#/admin?tab=support`. Riders and drivers use Account → Support.
