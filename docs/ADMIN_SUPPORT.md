# Admin and support

Clemson orange `#F56600`, purple `#522D80`. The dashboard is the web app at `#/admin` (Account → Admin dashboard). It is not a separate site.

## Sign in as admin

1. Open the live site or `npm run dev`, then `#/sign-in`.
2. Sign in with email and password for one of these Supabase Auth users:
   - `johnmatveev@gmail.com`
   - `johnmatveyev@gmail.com` (alternate spelling, so neither lockout)
   - `jmat2019@icloud.com`
   - `john@gmail.com` (previous production admin; still included)
3. Open `#/admin`.

The first sign-in upserts `profiles`. After `supabase/migrations/20260924190000_admin_support.sql` is applied, that upsert sets `profiles.role = admin` and `profiles.is_admin = true` for the emails above. The same migration seeds `admin_users`. `public.is_admin()` is true for those emails or for `role` admin/ops. There is no `USING (true)` policy.

Support-only rows in `admin_users.access_role = 'support'` can read the ticket inbox. They cannot approve drivers or open the PII admin views. Seeded addresses are admins, not support-only.

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
