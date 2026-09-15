# Build prompt 05 — Sandbox broadcaster + player

**Repo:** `~/ralphTV` (Phase 1), then `~/ralph-world` (Phase 2). Run Phase 1 here.
**Persona:** Architect.
**Also read:** `CLAUDE.md`, `ARCHITECTURE.md` (Services, Storage, Environment
Variables, Deployment), `RAILWAY_SETUP.md`, `changelog.md` entries for
2026-09-11 and 2026-09-15.

## Goal

An internal copy of the broadcaster and the Ralph TV player where we can try
content, scheduling and features — the live-event cut-in, mobile/vertical
work, prompt 02's streamer changes — without touching the 24/7 channel.

Decisions already made (Brook, 2026-09-15):

- **On demand.** Nothing streams in the sandbox unless someone presses Start.
  Idle containers only; no 24/7 ffmpeg, no second CDN.
- **Own S3 prefix.** Sandbox uploads and normalized files live under
  `sandbox/…` in the existing bucket. Production objects are never written.

Why this comes early: `CLAUDE.md` says streamer/relay changes get "a staging
test or an off-peak deploy". There has never been a staging, so it has always
been "or" — the 2026-08-21 relay crash-loop and the 2026-09-11 bookworm
migration both went straight to production because there was nowhere else.

## What exists (verified 2026-09-15)

- One Railway project, **RALPHTV BROADCASTER**, one environment
  (`production`), six services: `ralphTV-Frontend`, `Backend`, `Streamer`,
  `Transcoder`, `Relay`, `Database`. All five app services deploy from `main`
  on every push. Node services pin `builder: DOCKERFILE` in `<svc>/railway.json`.
- Private networking is on: `RELAY_IPV6=true` on the relay, streamer
  `RTMP_TARGET=rtmp://relay.railway.internal:1935/live/stream`. Railway's
  `*.railway.internal` names resolve **per environment**, so the same value
  works in a second environment without change.
- Bunny pull zone (`ralphtv-stream.b-cdn.net`) fronts the production relay.
  The sandbox does not need one — players hit the sandbox relay directly.
- S3: backend presigns uploads under `S3_PREFIX` (default `raw`,
  `backend/src/index.js:237`). The transcoder **hardcodes** the output key —
  `uploadNorm()` writes `normalized/${assetId}.mp4`
  (`transcoder/src/index.js`, ~line 200). So `S3_PREFIX` alone does not
  isolate a sandbox; the transcoder needs a matching variable.
- `DELETE /assets/:id` never deletes from S3 (no `DeleteObjectCommand` in the
  backend). Rows that point at production keys are read-only safe.
- `restoreDesiredState()` (streamer) auto-starts the channel on boot if the
  last `stream_actions` row is `start`/`restart`. A database **cloned** from
  production would therefore start the sandbox streamer by itself — the
  opposite of on-demand. Start the sandbox with an empty database.
- Backend seeds one admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on boot. That is
  the sandbox login — no `create:user` needed (which can't reach
  `postgres.railway.internal` from a laptop anyway).
- Frontend `VITE_*` values are baked at build time; Railway builds each
  environment separately, so per-environment values work as long as they are
  set **before** the first sandbox build.
- ralph-world is also on Railway (**RALPH WORLD 2.0**). It reaches the
  broadcaster through `BROADCASTER_BACKEND_URL`, `BROADCASTER_SERVICE_TOKEN`
  (server-side), and `BROADCASTER_RELAY_URL` (runtime, read by
  `app/api/broadcaster/relay-url/route.ts`; the `NEXT_PUBLIC_` variant is the
  legacy build-time path).

## Deliverables

### A. Small code changes — ship to `main`, inert in production

1. **Transcoder output prefix.** Add `S3_PREFIX_NORM` (default `normalized`)
   and use it in `uploadNorm()`. Production keeps writing
   `normalized/<id>.mp4`; the sandbox sets `sandbox/normalized`. Log it at
   boot next to `S3_BUCKET_UPLOADS`. Update the Transcoder env table in
   `ARCHITECTURE.md`.
2. **Visible environment label.** `VITE_ENV_LABEL` (frontend) → when set,
   render a thin coloured strip above the header reading e.g. `SANDBOX`.
   Nobody should be able to mistake the sandbox Broadcaster for the real one
   while pressing Stop. Backend `/healthz` returns `{ ok, env }` from
   `ENV_LABEL` so `curl` can tell them apart too. Keep both under the size
   budgets (`npm run lint`).
3. **Don't auto-resume when told not to.** `STREAMER_RESUME=false` already
   exists; verify it, document it in the Streamer env table. The sandbox sets
   it so a stray `start` row can never bring the sandbox streamer up on a
   redeploy.

### B. The Railway `sandbox` environment (manual, documented)

Write the steps into `RAILWAY_SETUP.md` under a new "Sandbox environment"
section as you do them. Verify each CLI flag against `railway --help`
(CLI 4.11 on this machine) before writing it down.

1. Duplicate `production` → `sandbox` (dashboard: Environment → Duplicate,
   or `railway environment new sandbox --duplicate production`). Confirm the
   `Database` service in the new environment is a **fresh, empty** Postgres,
   not a copy. If Railway copied data, drop `stream_actions` rows and every
   `assets`/`schedule*` row before anything boots.
2. **Branch.** Point every sandbox service's source at a `sandbox` branch
   (Service → Settings → Source), not `main`. That is what makes it a place to
   test unmerged streamer/relay changes: push a feature branch, merge it into
   `sandbox`, watch it deploy, then merge to `main`. Create the branch from
   `main` and keep it fast-forwarded when idle.
3. **Variables to change** in the sandbox environment (everything else stays
   as duplicated):

   | Service | Set |
   |---|---|
   | Backend | `S3_PREFIX=sandbox/raw`, `ENV_LABEL=sandbox`, new `JWT_SECRET`, new `SERVICE_TOKEN`, new `STREAMER_CONTROL_TOKEN`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (sandbox login), `RELAY_URL`/`STREAMER_URL` → sandbox service URLs, `CORS_ALLOWED_ORIGINS` → sandbox frontend + sandbox ralph-world origins |
   | Transcoder | `S3_PREFIX_NORM=sandbox/normalized` |
   | Streamer | `API_BASE_URL` → sandbox backend, `API_AUTH_TOKEN` = new `SERVICE_TOKEN`, `STREAMER_CONTROL_TOKEN` (match backend), `STREAMER_RESUME=false`; `RTMP_TARGET` unchanged (resolves to the sandbox relay) |
   | Relay | `RELAY_PUSH_*` empty; `RELAY_IPV6=true`, `RELAY_ABR=true` as prod. Add a TCP proxy on 1935 only when the live cut-in test needs OBS → relay |
   | Frontend | `VITE_API_BASE_URL`, `VITE_REALTIME_URL`, `VITE_STREAMER_BASE_URL`, `VITE_RELAY_BASE_URL` → sandbox URLs; `VITE_ENV_LABEL=SANDBOX`. Set **before** the first build |

   Use Railway-generated `*.up.railway.app` domains. A
   `sandbox.broadcaster.ralph.world` CNAME is optional and can come later.
4. **S3 credentials.** The prefix is a convention, not a guarantee. If the
   AWS/R2 account allows it, create a second access key whose policy is
   limited to `sandbox/*` (plus `ListBucket`) and use it for the sandbox
   backend + transcoder. If that isn't possible, say so in the wrap-up — the
   no-delete behaviour above still means production objects cannot be
   removed from the sandbox, only read.
5. **Cost.** With the streamer idle the sandbox is five near-idle containers.
   Railway's App Sleeping (`sleepApplication`) is fine for Frontend, Backend,
   Transcoder and Relay; do **not** enable it on the Streamer — once started
   it only receives `/status` polls and could be put to sleep mid-stream.
   Note the measured idle cost in the changelog after a week.

### C. Seed content

Do not clone production. Upload throwaway clips through the sandbox
Broadcaster: at least one **portrait** (9:16) clip, one long (>10 min), one
short (<30 s), one with a different frame rate. They land under
`sandbox/raw`, transcode to `sandbox/normalized`, and can be scheduled. If
real content is wanted later, write `backend/scripts/copy-assets-to-sandbox.mjs`
that `CopyObject`s selected raw keys into the sandbox prefix, inserts the
rows, and enqueues `normalize_jobs` — run from inside Railway, not a laptop.

### D. Phase 2 — ralph-world sandbox (`~/ralph-world`)

A `sandbox` environment on RALPH WORLD 2.0 (same duplicate-and-rebrand
pattern) with `BROADCASTER_BACKEND_URL`, `BROADCASTER_RELAY_URL`,
`BROADCASTER_SERVICE_TOKEN` pointed at the sandbox broadcaster, and the
preview gate (`PREVIEW_KEY`) carried over. ralph-world's own database, Stripe
and CMS wiring are **out of scope** — verify what the TV page needs to render
and set only that. This is the surface prompt 01 (mobile + vertical) tests
against.

### E. Live cut-in (scope only, don't build here)

Once B is up: `RELAY_PUBLISH_AUTH_URL` + `RELAY_PUBLISH_KEY` on the sandbox
relay, a Railway TCP proxy on 1935, and OBS pushing to
`rtmp://<proxy>/live/stream?key=…`. Write down what happens to the scheduled
loop while a live publish holds the same stream key — that is the design
question the real live-event prompt has to answer.

## Acceptance criteria

- Sandbox Broadcaster loads with the `SANDBOX` strip; login with the seeded
  sandbox admin works; production login does **not** work there (different
  `JWT_SECRET`, different users).
- Upload → `sandbox/raw/…`; transcode → `sandbox/normalized/<id>.mp4`; an S3
  listing of production `raw/` and `normalized/` is byte-for-byte unchanged.
- Start → sandbox relay `/api/status` goes `streaming:true`; the sandbox
  Broadcaster preview and (Phase 2) the sandbox TV page play it. Stop → idle.
  Redeploying the sandbox streamer while idle leaves it idle.
- Throughout: production relay `lastUpdated` keeps ticking, production
  `stream_actions` gains no rows, production `/status.sessionStartedAt` is
  unchanged (`scripts/watch-stream.sh` prints nothing).
- A push to `sandbox` deploys only sandbox services; a push to `main` deploys
  only production. Prove both with one no-op commit each.
- `npm run lint` passes in both repos.

## Constraints

- Nothing in Phase 1 may require a production redeploy of the streamer or
  relay beyond the inert changes in A. If A's changes need a production
  deploy, do it off-peak and confirm `restoreDesiredState` resumes the channel.
- No new dependencies. Don't add a second Bunny zone.
- Never point a sandbox service at the production database or the production
  `SERVICE_TOKEN`.

## Wrap-up

- `changelog.md` entry (both repos if Phase 2 lands); `ARCHITECTURE.md` env
  tables for `S3_PREFIX_NORM`, `ENV_LABEL`, `VITE_ENV_LABEL`, `STREAMER_RESUME`;
  `RAILWAY_SETUP.md` sandbox section.
- List every manual step and variable set, per service, so it can be redone.
