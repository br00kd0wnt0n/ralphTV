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
