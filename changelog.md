# Changelog: ralphTV

All notable changes to this project are documented here, organized by session.
History before 2026-09-10 is in `git log` (the project predates this file).

---

## 2026-09-15 — ARCHITECT mode (docs only)

**Session goal:** Answer "what's next", fold in two new asks from Brook.

### Added
- `docs/build-prompts/05-sandbox-environment.md` — on-demand sandbox of the
  full stack on a `sandbox` Railway environment tracking a `sandbox` branch,
  own S3 prefix. Decisions: on demand, own prefix (Brook). Findings that
  shaped it: the transcoder hardcodes `normalized/<id>.mp4` so `S3_PREFIX`
  alone doesn't isolate; asset delete never touches S3; a cloned
  `stream_actions` table would auto-start the sandbox streamer via
  `restoreDesiredState`.
- Prompt 01 Part C — vertical-aspect content, marked priority. Verified: the
  transcoder pads portrait sources to a 405x720 strip (32% of the frame,
  downscaled from 1080); the immersive overlay uses `fit="contain"`; the
  pixel-sampling auto-zoom exists only in ralphTV's `/embed` player, not in
  ralph-world's `LivePlayer`. Recommended path is metadata-driven
  (`src_width`/`src_height` at transcode → `/now-playing.aspect` → fit
  switch), with the pixel detector as a spike/fallback. Full-res vertical
  needs a second stream — scope only.
- README: row 05, new order (01 → 05 → 02 → 04A → 03 → 04B), Railway CLI
  gotchas, logins status.

### Changed
- `ARCHITECTURE.md` deployment table: bookworm base images (see 2026-09-11).
- `build.watchPatterns` in all five `railway.json` files. Until now every
  push — docs included — rebuilt and restarted all five services; that is
  how the 2026-09-11 `create:user` merge turned into three build failures
  and a streamer restart. Now a push redeploys only services whose files
  changed. Per Railway docs the patterns are gitignore-style and anchored
  at the repo root even when a Root Directory is set; the frontend uses
  `/**` minus the four service dirs, `docs/`, `scripts/`, `.claude/` and
  root `*.md`. Verified: the docs-only commit after this one created no
  deployments.

### Investigated
- Does the self-heal resume where the feed left off? **No** in continuous
  mode: every spawn starts the day at item 0
  (`CONTINUOUS_STATE.startedAt = Date.now()`, `streamer/src/index.js:842`),
  so a redeploy, the day-rollover reload and Restart all replay the day
  from the top. The main loop already fetches the wall-clock pointer
  (`/feed/…/now` → `computePointer`) and the continuous branch ignores it.
  Written up as prompt 02 Part C, then built the same evening on branch
  `feat/resume-at-position` (see below).

### Built — `feat/resume-at-position` (unmerged, awaiting deploy)
- The streamer saves "which clip started when" through the backend
  (`PUT /streamer/state` → new `streamer_state` table, migration `0008`)
  every time the continuous loop spawns and again once background
  downloads have probed real durations. `GET /streamer/desired-state` now
  returns it. On the next spawn — redeploy, Restart, day-rollover reload —
  `planResume()` works out which clip should be on air and how far in,
  `buildContinuousList()` rotates the play order to start there (so that
  clip is the first one downloaded) and ffmpeg gets `-ss <offset>` before
  the concat `-i`. `computeContinuousCurrent()` reports the schedule slot
  (`index`) regardless of rotation, so the Broadcaster's glow/playhead and
  `/now-playing` are unchanged. Session clock survives restarts too.
- Semantics: Stop clears the saved position (next Start = item 0); Restart
  and self-heal resume; a new day starts at its top; an edited schedule
  resumes at the same asset wherever it now sits; a removed asset falls
  back to the top. Kill switch: `STREAMER_RESUME_POSITION=false`.
- Verified: `-ss` into a concat list in copy mode, encode mode and across a
  file boundary with local ffmpeg; 14 unit scenarios against the real
  `planResume`/`computeContinuousCurrent`/`toPersistedState` source.
  First deploy still restarts at item 0 once (the running build has saved
  nothing yet).
- Also fixed on `main` (`e6abf38`): the Broadcaster preview latched on the
  offline card after any relay restart — the status poll cleared its own
  interval when `relayAvailable` went false and nothing set it back.
- Noted: `npm run lint` is red on `main` independently of today's work —
  four files over the AGENTS.md hard size limits (`HlsPlayer.tsx` 483/260,
  `content-scheduler.css` 834/380, `LibraryPanel.tsx`, `LiveEmbedPlayer.tsx`)
  and six pre-existing type errors (`NodeJS.Timeout`, `HeadersInit`).

### Open
- Matt's Broadcaster login (manual, Data tab).
- Parked branches, built and unmerged, awaiting a decision:
  `perf/idle-preview-suspend` (suspend the admin preview when the tab is
  hidden/idle — cuts origin + CDN pulls from parked tabs) and
  `feature/instagram-live` (RTMPS bridge for attended Instagram Live events,
  reverted from main 2026-08-21 before it was ever used). Merged-and-stale
  remotes `fix/resume-channel-after-restart` and
  `perf/private-networking-egress` can be deleted.

---

## 2026-09-11 — infrastructure (no persona session)

### Added
- `backend/scripts/create-user.mjs` + `npm run create:user` — role-scoped
  account creation, same bcrypt/stdin pattern as `seed-admin.mjs`. Caveat
  discovered the same day: `railway run` from a laptop cannot resolve
  `postgres.railway.internal`, so it only works from inside Railway.
  `nicola@ralph.world` and `guestadmin@ralph.world` (both admin) were added
  by hand via the Railway Data tab with locally generated hashes.

### Fixed
- Relay, Transcoder and Streamer builds were failing on every push:
  Debian bullseye-security's package files are gone from `deb.debian.org`
  and `security.debian.org` and not yet in `archive.debian.org` (its
  `debian-security/dists/` stops at buster). Two apt-source workarounds
  (`Check-Valid-Until=false`, archive redirect) were tried and disproved by
  the real build logs before migrating all three Dockerfiles to
  `bookworm-slim` (`4d370db`). ffmpeg 4.3.9 → 5.1.9. Production was never
  down — Railway kept serving the last good builds; the final cutover
  self-healed (`streaming:true` within ~20s).

### Learned
- `railway logs --build --service X` returns the last *successful* build
  when one exists; pass the failed deployment id to see the real error.

---

## 2026-09-10 — ARCHITECT mode

**Session goal:** Turn the Matt (BBC iPlayer) consultation next-steps into
self-contained build prompts, and create the missing foundation docs.

### Added
- `CLAUDE.md` and this `changelog.md` (foundation docs were missing).
- `docs/build-prompts/` — index plus four prompts: mobile player fix,
  asset-delete stream-drop investigation, content metadata enrichment,
  analytics (GA player events + owned viewer-analytics dashboard).

### Decisions made
- Mobile fix targets `~/ralph-world` (the viewer surface), not this repo's
  `/embed` player: ralph-world renders its own `LivePlayer` and does not
  iframe `/embed`.
- Metadata plan reuses the existing `tags`/`asset_tags` tables and unmounted
  `TagEditor.tsx` rather than adding a parallel keyword model; genre becomes
  a controlled column on `assets`.
- Analytics is split: GA/GTM events first (cheap, consent-gated, biased),
  then an owned event ingest in the broadcaster backend for real session
  data (the CDN cannot provide it).

### Investigated — the "content-deletion restart glitch" (same evening)
- Not the delete. `stream_actions` shows stop 15:27:30, start 15:27:35,
  restart 15:28:04, stop 15:28:14, restart 15:28:19 UTC (16:27–16:28
  London), all `brook@ralph.world`, each doubled (frontend + proxy logging).
  Streamer log has `Cleaning up streamer... / Sending SIGINT` at exactly
  those times; the first killed an ffmpeg that had run 16h26m
  (frame≈1.42M). Each rebuild took 6–10s -> ~50s of flapping.
- Backend logged no `asset delete error`; `Sample_Media_Clip_10.mp4`
  (asset 7b7ec597, transcoded 15:18 UTC) was deleted cleanly, no
  `normalize_jobs` rows remain. No rollover, crash, container restart, or
  relay event in the window. Relay logs only reach back ~45 min at 5000
  lines — useless for forensics; streamer + `stream_actions` were enough.
- Side observation: the transcoder's poll counter reset to #1 at 15:18:10
  right after finishing that job, with all job lines sharing one timestamp
  -> the transcoder process restarted then. Unrelated to the stream; worth
  a look if it recurs.
- Tooling: `~/ralphTV` was Railway-linked to the wrong project
  ("PULSE ENGINE"); relinked to "RALPHTV BROADCASTER" (services are
  `Streamer`, `Relay`, `Backend`, `Transcoder`, `ralphTV-Frontend`,
  `Database`). Added `scripts/watch-stream.sh` (polls streamer + relay
  status, prints on change) for future replications.

### Known issues
- `DELETE /assets/:id` comment claims cascade handles schedule references;
  `schedule_items.asset_id` has no `ON DELETE` action, so deleting a
  scheduled asset 500s and the UI swallows the error (prompt 02).
- `TagEditor.tsx` exists but is not mounted anywhere (prompt 03).
- Frontend and backend both log stream actions -> duplicate
  `stream_actions` rows per click (noted in commit 3f9be14, still open).

---

## Pre-history (from git log, for orientation)

- 2026-08-21 — relay IPv6 listeners for Railway private networking (~1.5TB/mo
  egress saved) + `ipv6only=on` hotfix after a crash loop.
- 2026-08-20 — streamer resumes the channel after a restart
  (`restoreDesiredState`, backend `GET /streamer/desired-state`).
  Instagram RTMPS bridge landed and was reverted the same day.
- 2026-08-05 — streamer atomic downloads, retries, real durations, ON AIR log.
- 2026-07 — ABR renditions (480p rung), `/now-playing` endpoint for
  ralph-world, per-asset `description` (migration 0007), scheduler playhead.
- 2026-06 — three security hardening passes (see HARDENING_ACTIONS.md).
