# Self-hosting Clemson RIDES on the Hostinger VPS

Production for https://clemsonrides.com runs on John's Hostinger KVM (AlmaLinux, Docker, Traefik). The image is built in GitHub Actions and pulled on the VPS. Vercel stays in place as a rollback for at least 24 hours after DNS cutover. This change does not edit DNS, Vercel, Stripe, Supabase, or Resend.

The app container is its own compose project (`clemson-rides`), its own bridge network, and a non-root user. It does not join Traefik's network, and it does not restart or edit any other stack.

## Why the image is built in GitHub Actions

The box has about 7.9 GB RAM, about 1.5 GB free, and no swap. `npm ci` plus `vite build` on the VPS can OOM-kill Hermes, OpenClaw, n8n, or Traefik. GitHub Actions builds `ghcr.io/ascendmaui/clemson-airport-rides`, tags it with the commit SHA and `prod` (or `staging`), and the VPS only pulls that image. Production deploys are serialized in the `deploy-vps-prod` concurrency group (`cancel-in-progress: false`, `queue: max`). Staging uses `deploy-vps-staging`, so a staging run does not sit in the production queue. On the VPS a file lock still keeps the two from rewriting one git checkout at the same time.

`VITE_*` values are inlined into the browser bundle at build time, so they are GitHub Actions secrets passed as Docker build args. Server secrets stay in `/opt/clemson-rides/.env` and are never baked into the image.

The container is Node 22. The host's Node 24 is not used.

## GHCR pull access

Recommend a **public** package. The image contains the same source as the public repo plus the public browser keys (`VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, the Maps key). It does not contain `CRON_SECRET`, the Stripe secret, the service role key, or Resend. A public package means the VPS does not need a token.

The deploy workflow tries to mark `ghcr.io/ascendmaui/clemson-airport-rides` public. If org policy blocks that, either flip the package to public in GitHub (Package settings → Change visibility) or, once, on the VPS:

```bash
docker login ghcr.io
```

Use a GitHub user or machine account and a PAT with only `read:packages`. Do not put that PAT in the repo or in the app `.env`.

## GitHub secrets John must add

Deploy SSH:

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | `31.97.11.12` |
| `VPS_USER` | User that can run Docker and read the mode-600 env file. Use `root` if the env file is root-only. |
| `VPS_SSH_KEY` | Private key for that user. Paste the PEM with real line breaks. |
| `VPS_KNOWN_HOSTS` | One line from `ssh-keyscan -H 31.97.11.12`. |

Build-time public values (Actions secrets so the log masks them). All five are passed as build args. The site is broken or half-broken if the required ones are empty.

| Secret | Required at build | If it is missing |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Optional | Browser falls back to `https://awktabuhijrshmsmagpq.supabase.co`. |
| `VITE_SUPABASE_ANON_KEY` | Required | Sign-in, trips, and realtime do not start. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Required | Card form and Apple Pay do not load. |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional | Map tiles stay blank. Fares still quote from the server key. |
| `VITE_APP_URL` | Optional | Checkout return URLs fall back to `https://clemsonrides.com`. Also read at runtime if set in the VPS env. |

`NEXT_PUBLIC_*` is not inlined by Vite (the prefix Vite exposes is `VITE_`). Do not rely on those names in the browser bundle.

## Runtime env on the VPS

`/opt/clemson-rides/.env` is root-owned, mode `600`, and never committed. Do not set `VERCEL`. Do not put `GIT_SHA` here; the image already has the commit it was built from. `CRON_SECRET` was rotated and must be the same value in all three places: this file, Vercel production, and the Supabase Vault secret `clemson_cron_secret`.

Copy names from `.env.example`. The ones the server actually reads are listed in the pull request env inventory. Minimum for a working API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `GOOGLE_MAPS_API_KEY`, and one of `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` if Help should call a model. `RESEND_API_KEY` and `RESEND_FROM` are optional; without them mail is skipped and the in-app queue still works.

## First deploy

Traefik is `traefik-bmeb-traefik-1`, image `traefik:latest`, **host networking**, so it already owns ports 80 and 443. Confirm, and do not attach Clemson to another network:

```bash
docker inspect traefik-bmeb-traefik-1 --format '{{.HostConfig.NetworkMode}}'
docker network ls
```

`NetworkMode` should be `host`. Clemson uses its own bridge. The name defaults to `clemson_rides_net` (`CLEMSON_NETWORK` overrides it). The compose label `traefik.docker.network` is set to that same name so Traefik picks the container IP on that bridge.

Confirm the HTTPS entrypoint name Traefik actually uses (this repo defaults to `websecure` and cert resolver `letsencrypt`):

```bash
docker inspect traefik-bmeb-traefik-1 --format '{{json .Args}}'
```

If the entrypoint is not `websecure`, export `TRAEFIK_ENTRYPOINT` to the name you see (often `websecure` or `https`) before `docker compose up`.

```bash
sudo mkdir -p /opt/clemson-rides
sudo chmod 700 /opt/clemson-rides
sudo git clone https://github.com/ascendmaui/clemson-airport-rides.git /opt/clemson-rides/src
sudo install -m 600 /dev/null /opt/clemson-rides/.env
sudoedit /opt/clemson-rides/.env
```

After the GitHub Actions workflow has pushed an image (or you have built one elsewhere with the same Dockerfile and build args):

```bash
cd /opt/clemson-rides/src
sudo IMAGE_TAG=<commit-sha> \
  STAGING_IMAGE_TAG=<commit-sha> \
  CLEMSON_NETWORK=clemson_rides_net \
  TRAEFIK_ENTRYPOINT=websecure \
  TRAEFIK_CERTRESOLVER=letsencrypt \
  docker compose -f deploy/docker-compose.yml --project-name clemson-rides up -d --no-build web
curl -fsS http://127.0.0.1:3080/api/healthz
```

`127.0.0.1:3080` is loopback-only, for debugging. Ports 80 and 443 are not published. Do not bind `8787`, `8790`, `9101–9111`, `9200`, `9300`, `18789`, `32768–32774`, `44286`, or `60949`.

The container limit is 512 MB and 1 CPU (`mem_limit` / `cpus`).

### Staging

Staging is a second container, started only with the compose profile, so it does not replace production. It is another 512 MB. Stop it when you are done.

```bash
sudo STAGING_IMAGE_TAG=<commit-sha> \
  IMAGE_TAG=<commit-sha> \
  docker compose -f /opt/clemson-rides/src/deploy/docker-compose.yml \
  --project-name clemson-rides --profile staging up -d --no-build staging
curl -fsS http://127.0.0.1:3081/api/healthz
curl -fsS https://clemson-staging.srv1090862.hstgr.cloud/api/healthz
```

The staging Traefik router is only `clemson-staging.srv1090862.hstgr.cloud`. That name already resolves to this VPS, so Let's Encrypt HTTP-01 works before any DNS change for clemsonrides.com. Production stays on `clemsonrides.com`, and `www.clemsonrides.com` redirects to the apex. Staging does not attach to either name.

Staging and production share `/opt/clemson-rides/.env`. The staging service sets `DISABLE_CRON_ENDPOINTS=1` and `ALLOW_STAGING_DRY_RUN=1` in Compose, which overrides the shared file for that container only. Do not put those two variables in the shared env file, or production cron will stop too.

With `DISABLE_CRON_ENDPOINTS=1`, these cron calls return 403 even with a valid bearer:

- `/api/driver-payouts` (and `/api/driver?action=payouts` when the caller is the cron bearer)
- `/api/expire-unpaid-airport-holds`
- `/api/driver?action=rebroadcast-offers`

A signed-in driver can still GET their earnings summary. A signed-in payout retry POST is also 403, so staging cannot create a Stripe transfer. Dry-run (`?dry_run=1`) is refused unless `ALLOW_STAGING_DRY_RUN=1`. Staging turns that on, because dry-run does not transfer money or write a payout row. Leave it off if you want staging to refuse dry-run as well.

`workflow_dispatch` runs only after this workflow file is on `main`. Until then, a push to `staging/**` or to `cursor/hostinger-vps-self-host-4d20` builds from that branch, pushes the image tagged `staging` and the commit SHA, and deploys the staging service only. That push never tags `prod` and never restarts `clemson-rides-web`. If `VPS_SSH_KEY` is missing, the workflow still pushes the image and skips SSH with a notice. A push to `main` deploys production only after the `CI` / `test` workflow succeeds. Manual deploy, once the file is on `main`: Actions → Deploy VPS → Run workflow → target `production` or `staging`.

CI on a pull request also triggers this workflow via `workflow_run`, and the deploy job is skipped. That skipped run uses its own `deploy-vps-noop-<run id>` group, so it does not queue behind a production deploy.

### Swap

Traefik on this host uses the Docker provider in host networking. With the default `allowEmptyServices=false`, a container that is stopped or still `starting` is not a backend. When `clemson-rides-web` was the only backend, recreating it made `https://clemsonrides.com` (including `/` and `/home` after Google sign-in) answer with Traefik's own `404 page not found`, or reset the connection, until the new process was healthy.

`deploy/remote-up.sh` avoids that gap when a healthy backend is already up:

1. Start `clemson-rides-web-next` (compose profile `overlap`) with the same Traefik service labels as `web`. It does not publish port 3080. It stays on `clemson_rides_net` the whole time.
2. Wait until Docker reports it healthy and its own `/api/healthz` shows the new SHA. Traefik on this host only reloads on container start, stop, and health changes. Taking the container off the network before that health change hides it from Traefik, and connecting it afterward does not add the backend.
3. Poll the public `/api/healthz` until Traefik serves the new SHA at least once. The previous container may still answer some of those requests. Only then recreate `clemson-rides-web`. The new container also stays on `clemson_rides_net` while it becomes healthy, and the overlap container covers that recreate.
4. If that poll never sees the new SHA, remove the overlap container first (the live container is still serving), then recreate `clemson-rides-web` in place and roll back to the previous image if `/api/healthz` does not return the new SHA.
5. Remove `clemson-rides-web-next` only after the new `clemson-rides-web` is healthy on `clemson_rides_net`. If Traefik then answers with the old SHA or its own 404, restart `clemson-rides-web` once so Traefik sees a fresh start and health change. If that still fails, roll back to the previous image.

Host checks against `127.0.0.1:3080/api/healthz` poll for up to 60×2 seconds. That wait happens while the overlap container can still serve, so a longer poll is not a longer public outage. Staging does the same with `clemson-rides-staging-next` and port 3081. A hand `docker compose up` of `web` alone still recreates in place and can 404; use the deploy script for a production swap.

The overlap container is a second 512 MB cap for about a minute. It is not a reservation. Do not start a second overlap by hand while a deploy is running.

## Check TLS before DNS cutover

Let's Encrypt HTTP-01 for `clemsonrides.com` succeeds only when that name resolves to this VPS, because Traefik answers port 80. `clemson-staging.srv1090862.hstgr.cloud` already points here, so staging can get a certificate before cutover. Use `--resolve` to preview the apex against the VPS IP:

```bash
curl --resolve clemsonrides.com:443:31.97.11.12 https://clemsonrides.com/api/healthz
```

If Traefik has no certificate for that name yet, the TLS handshake fails. `curl -k --resolve clemsonrides.com:443:31.97.11.12 https://clemsonrides.com/api/healthz` shows the app anyway. Do not leave `-k` in a monitor.

## DNS cutover and rollback

1. Confirm `curl -fsS http://127.0.0.1:3080/api/healthz` shows the SHA you intend to serve.
2. Point `clemsonrides.com` and `www.clemsonrides.com` A/AAAA records at `31.97.11.12`.
3. Wait until `https://clemsonrides.com/api/healthz` returns that SHA without `--resolve`.
4. Leave the Vercel project and `vercel.json` untouched for at least 24 hours.

Rollback is DNS back to Vercel. That restores the previous host immediately. To roll the VPS image back without touching DNS, the deploy script retags the previous SHA and runs it again when the overlap container is not already serving the new SHA. If the new overlap container is healthy and the canonical container fails, the script leaves the overlap container up and exits non-zero instead of putting the previous image back beside it. By hand:

```bash
cd /opt/clemson-rides/src
sudo IMAGE_TAG=<previous-sha> \
  docker compose -f deploy/docker-compose.yml --project-name clemson-rides up -d --no-build web
```

That hand command recreates `web` in place. Expect a short Traefik gap unless `clemson-rides-web-next` is already healthy on `clemson_rides_net`.

The previous SHA is recorded in `/opt/clemson-rides/previous-sha` after a successful deploy. A failed health check exits non-zero. This never runs `docker system prune` and never restarts other projects.

## Cron

Hold expiry is already applied in production. Supabase migration `repoint_hold_expiry_cron_to_clemsonrides_com` (about 04:33 UTC on 2026-10-05) replaced `private.trigger_expire_unpaid_airport_holds()` so it calls `https://clemsonrides.com/api/expire-unpaid-airport-holds`. The repo copy is `supabase/migrations/20261005043300_repoint_hold_expiry_cron_to_clemsonrides_com.sql`. It is `CREATE OR REPLACE` only. Do not add another hold-expiry scheduler. The bearer is Vault secret `clemson_cron_secret`, which must match `CRON_SECRET` on the VPS and on Vercel.

`private.trigger_matching_rebroadcast()` already calls `https://clemsonrides.com/api/driver?action=rebroadcast-offers` every minute. It follows DNS, so after cutover it hits the VPS. Its bearer is the same Vault secret and must match the VPS `CRON_SECRET`. Leave that job alone.

Driver payouts replace the Vercel cron `0 12 * * *` UTC. Use **pg_cron**, not a container or a systemd timer on the VPS. pg_cron and pg_net are already installed, the Vault secret already exists, and the box should not grow another process. The SQL is `supabase/migrations/20261005130000_driver_payouts_pg_cron.sql`. It is **not** applied. Run it in the Supabase SQL editor after the VPS is answering `https://clemsonrides.com/api/healthz`. It calls `https://clemsonrides.com/api/driver-payouts` with `Authorization: Bearer <clemson_cron_secret>` and a 60 second timeout. Off Vercel that route accepts the bearer alone (`VERCEL` is unset). Requests with no bearer are rejected. `?dry_run=1` still requires the bearer and computes due payouts without creating a Stripe transfer or writing a payout row.

Do not call the payout route with a live bearer until you have checked dry-run:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://clemsonrides.com/api/driver-payouts?dry_run=1"
```

## Logs, restart, disk

```bash
docker logs -f clemson-rides-web
docker compose -f /opt/clemson-rides/src/deploy/docker-compose.yml --project-name clemson-rides restart web
```

Request logs are JSON lines with `method`, `path` (no query string), `status`, and `ms`. They do not include headers or env values.

The deploy script deletes old `ghcr.io/ascendmaui/clemson-airport-rides` tags only, after keeping `prod`, `staging`, the running SHA, the previous SHA, and five newer tags. Disk has about 50 GB free. Do not run `docker system prune` on this host.
