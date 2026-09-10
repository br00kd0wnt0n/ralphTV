# Build prompt 04 — Viewer analytics: GA player events, then an owned dashboard

Two phases. **Phase A** runs in `~/ralph-world` and is a half-day. **Phase B**
runs mostly in `~/ralphTV` and is a real feature. Do A first, let it collect
for a couple of weeks, then decide whether B is needed and what it must show.

## The problem

- bunny.net gives bandwidth and requests, not sessions or watch time.
- GA shows the TV page at ~5% of ralph.world traffic, 171 views since
  2026-08-16, 23s average engagement — but "engagement" is page-level, not
  player-level. We can't tell "bounced before pressing play" from "watched 20s
  and left" from "hit the rotate wall".
- We want: watch time per show, drop-off within a show, content-type
  performance, device split, concurrent viewers. Enough to give Nicola/Tom a
  feedback loop on scheduling.

## What exists (verified 2026-09-10)

- ralph-world loads **GTM**, not GA directly: `lib/gtm-client-init.ts`
  `initGTM()` pushes to `window.dataLayer` once `NEXT_PUBLIC_GTM_ID` is set
  and the visitor has accepted analytics cookies (`components/legal/CookieBanner.tsx`).
  So any event we push is consent-gated — expect undercounting, and say so on
  every chart.
- There are **no player events anywhere** — nothing in `components/tv/*`
  pushes to `dataLayer`. GA4's built-in video engagement only fires for
  YouTube embeds, so it's irrelevant here.
- `components/tv/LivePlayer.tsx` owns the `<video>` + hls.js;
  `TVSet.tsx` knows the surface (`isMobile`, `immersive`, `iosNativeFs`,
  `isPortrait`), the gate (`gateActive`), and `nowPlaying.current`
  (`assetId`, `showName`) from `/api/broadcaster/now-playing` polled every 10s.
- The broadcaster backend (`~/ralphTV/backend/src/index.js`) has
  `GET /now-playing` (public), Postgres, and an auth model where public
  routes are fine as long as they don't mutate scheduling
  (`requireWrite` gates everything editorial).
- The `~/ralphTV` `/embed` player (`LiveEmbedPlayer.tsx`) is a separate
  surface; Phase A ignores it, Phase B's ingest should accept it.

---

## Phase A — GA4 player events via GTM (`~/ralph-world`)

### Deliverables
1. `lib/analytics/tv-events.ts`: a tiny typed wrapper —
   `trackTv(event, params)` that pushes `{ event: 'ralphtv_<name>', ...params }`
   to `window.dataLayer` and no-ops when it's absent (consent not given, SSR,
   tests). No new dependency. Include `surface: 'desktop' | 'immersive' | 'ios-native'`,
   `orientation`, `asset_id`, `show_name`, `is_guest`, `gate_active` on every
   event from a single `baseParams()` in `TVSet.tsx`.
2. Events (fire from `LivePlayer.tsx` / `TVSet.tsx`):
   - `ralphtv_page_view` (TV page mounted, `is_live`)
   - `ralphtv_play` / `ralphtv_pause` (video `playing` / `pause`)
   - `ralphtv_heartbeat` every 30s while playing, with `watch_seconds`
     (cumulative this page load) and `offset_sec` into the current asset
     (from now-playing's `offsetSec`). This is the one that makes watch time
     and drop-off computable.
   - `ralphtv_show_change` when `nowPlaying.current.assetId` changes while
     playing (carries `previous_asset_id`).
   - `ralphtv_stall` / `ralphtv_error` (hls.js `ERROR` with `fatal`, native
     `waiting` > 3s)
   - `ralphtv_immersive_enter` / `_exit`, `ralphtv_rotate_wall_shown`
   - `ralphtv_gate_shown`, `ralphtv_subscribe_click`
   - `ralphtv_offline_view` (page shown while `!isLive`)
3. Throttle: heartbeats only while `document.visibilityState === 'visible'`
   and the video isn't paused. Don't fire anything from the second
   `LivePlayer` instance in immersive mode *and* the cutout one at once —
   the cutout unmounts on mobile, so this should already hold; verify.
4. A vitest for the wrapper (no-op without dataLayer; correct shape with).

### Manual steps (flag for Brook, can't be done from code)
- In GTM: one trigger "Custom Event matches regex `^ralphtv_`", one GA4
  Event tag that forwards the event name and maps `asset_id`, `show_name`,
  `surface`, `watch_seconds`, `offset_sec` as event parameters. Publish.
- In GA4: register `asset_id`, `show_name`, `surface` as custom dimensions
  and `watch_seconds` as a custom metric so they show in Explore. Build one
  Explore: watch_seconds by show_name, and a funnel page_view -> play ->
  heartbeat(>=60s).
- Confirm `NEXT_PUBLIC_GTM_ID` is set in Railway for ralph-world production.

### Acceptance
- With consent accepted, GTM preview shows the events with the right params
  during a 2-minute watch on desktop and on a phone.
- With consent declined, nothing is pushed and no console errors.
- `npm run lint && npm run test` pass.

---

## Phase B — Owned viewer analytics in the broadcaster (`~/ralphTV` + one client change)

Do this if, after two weeks of Phase A, the consent gap or GA's aggregation
makes the numbers unusable for scheduling decisions — or if Brook wants a
"concurrent viewers now" readout in the broadcaster, which GA can't give.

### Design
- **Client**: same event wrapper, second sink. `trackTv` also
  `navigator.sendBeacon(`${BROADCASTER_URL}/analytics/events`, JSON)` with a
  per-tab anonymous `session_id` (random UUID in `sessionStorage`, never a
  cookie, never tied to the user account) and a coarse `device`
  (`mobile|tablet|desktop`) + `ua_family`. No IP storage server-side. This
  is not consent-gated on the basis that it's first-party, non-identifying
  operational telemetry — **confirm with Brook against the site's cookie
  policy wording before shipping**; if the policy says otherwise, gate it
  behind the same consent flag.
- **Backend** (`backend/src/index.js` or a new `backend/src/analytics.js`
  mounted from it — the index is already ~1500 lines, split):
  - `POST /analytics/events`: public, `express.json({ limit: '16kb' })`,
    CORS restricted to the ralph.world origins already in
    `CORS_ALLOWED_ORIGINS`, validates `{ event, session_id, ts, asset_id?,
    surface?, watch_seconds?, offset_sec?, device? }` against an allowlist
    of event names, drops anything else. Rate limit per IP in memory
    (~60/min) — no new dependency needed, a Map with a sliding window is
    fine at this scale.
  - Migration `0009_viewer_events.sql`: `viewer_events(id bigserial, ts
    timestamptz, event text, session_id uuid, asset_id uuid null, surface
    text, device text, watch_seconds int, offset_sec int)` + indexes on
    `(ts)`, `(asset_id, ts)`, `(session_id)`. Nightly purge > 90 days
    (a `setInterval` in the backend is enough; no cron infra).
  - Read endpoints (admin JWT, `authMiddleware` + role admin):
    - `GET /analytics/live` -> `{ concurrent: distinct session_ids with a
      heartbeat in the last 60s, by surface }`
    - `GET /analytics/summary?from&to` -> sessions, plays, total watch
      hours, median session watch time, device split
    - `GET /analytics/assets?from&to` -> per asset: plays, watch hours,
      avg watch %, drop-off curve (heartbeat counts bucketed by
      `offset_sec` / 30) — joined to `assets` for name/category/genre
      (genre exists if prompt 03 landed)
    - `GET /analytics/timeline?from&to&bucket=hour` -> concurrent viewers
      over time (for overlaying against the schedule)
  - Pure SQL, no analytics libraries.
- **Broadcaster UI**: a new "Analytics" tab/panel alongside the scheduler
  (`src/components/AnalyticsPanel.tsx` + `src/api/analytics.ts` +
  `src/styles/analytics.css`). Load the `dataviz` skill before drawing
  anything. Views: live concurrent (big number + by surface), last-7-days
  watch hours by category and by genre, top assets table with avg watch %,
  and a per-asset drop-off sparkline. Keep to the 220-LOC budget per
  component — this will be 3–4 files. Inline SVG, no chart library, unless
  Brook says otherwise (flag it).
- **Streamer overlay hook (optional)**: `OnAirTile.tsx` already shows
  what's playing; add the live concurrent count next to it so the
  broadcaster shows "ON AIR · 14 watching".

### Acceptance
- Beacon events arrive from ralph-world desktop and mobile; invalid
  payloads are rejected 400 with no DB write; rate limiting kicks in at the
  configured threshold.
- `/analytics/live` reflects a real second browser opening the TV page
  within ~30s and dropping off within ~90s of closing it.
- Summary/asset numbers reconcile with a hand-counted 10-minute test
  (one session, two shows).
- No PII columns; a `select` over `viewer_events` has nothing you couldn't
  publish.
- `npm run lint` passes in the frontend; backend restarts cleanly with the
  new migration; the streamer/relay are untouched.

### Manual steps
- Add the ralph.world origins to `CORS_ALLOWED_ORIGINS` on the backend
  service if they're not already there.
- `NEXT_PUBLIC_BROADCASTER_URL` (or reuse an existing public URL var) in
  ralph-world so the client knows where to beacon.
- Cookie-policy wording check (see Design).

---

## Constraints for both phases

- No third-party analytics SDKs; no new frontend dependencies.
- Never send email, user id, or IP in an event. `is_guest` boolean is the
  most identity we carry.
- Keep event names stable once shipped — GA4 custom dimensions and the
  Phase B allowlist both key on them. Prefix everything `ralphtv_`.
- Undercounting caveat (consent) goes on every chart title in Phase B and
  in the GA Explore description.

## Wrap-up

- Changelog entry per repo touched.
- Phase A: list the GTM/GA4 manual steps as a checklist for Brook.
- Phase B: update `ARCHITECTURE.md` (new table, endpoints, the purge job)
  and `RAILWAY_SETUP.md` (CORS + env var).
