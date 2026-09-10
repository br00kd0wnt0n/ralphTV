# Project: ralphTV (Broadcaster)

## Global context
~/context-base/CLAUDE.md

## Persona files
~/context-base/personas/

## Project brief
No brief in ~/context-base/projects yet. Working brief: owned 24/7 streaming
channel for Ralph World. Build prompts for the current roadmap live in
`docs/build-prompts/` — start there for any of the Sept 2026 next steps.

## Current persona
ARCHITECT — ~/context-base/personas/architect.md
(Platform is live and stable — ~480h uptime. Harden and extend; don't rebuild.)

## Session goal
[Update before each session. Pick a prompt from docs/build-prompts/README.md.]

---

## Foundation documents
- [ARCHITECTURE.md](ARCHITECTURE.md) — services, API, schema, env vars
- [changelog.md](changelog.md) — session-by-session change history
- [AGENTS.md](AGENTS.md) — frontend size budgets + DnD rules (enforced by `npm run lint:size`)
- [RAILWAY_SETUP.md](RAILWAY_SETUP.md), [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [HARDENING_ACTIONS.md](HARDENING_ACTIONS.md)

## Quick start
```bash
npm install
npm run dev          # frontend (Vite) on :5173
npm run lint         # typecheck + size budgets — run before every commit
```
Backend / streamer / transcoder / relay each run from their own folder (see ARCHITECTURE.md). Live URLs: frontend https://broadcaster.ralph.world, backend https://backend-production-3f879.up.railway.app.

## Key files
- Frontend entry: `src/main.tsx` -> `src/App.tsx` -> `src/components/ContentScheduler.tsx`
- Public embed player: `src/components/embed/LiveEmbedPlayer.tsx` + `src/hooks/useHls.ts`
- API routes: `backend/src/index.js` (single file, ~1500 LOC), pointer maths in `backend/src/feed.js`
- DB schema: `backend/migrations/0001..0007` (sequential SQL, run by `npm run migrate` on backend boot)
- Streamer loop: `streamer/src/index.js` (`streamContinuous`, `restoreDesiredState`, `/control/*`)
- Relay: `relay/nginx.conf.template` (RTMP in -> HLS out -> bunny.net CDN)

## Related repos (same machine)
- `~/ralph-world` — Next.js consumer site. **The viewer-facing TV page is here**: `components/tv/TVSet.tsx`, `LivePlayer.tsx`; it talks to this backend via `lib/broadcaster/client.ts` (`/now-playing`, `/feed/.../playlist`, `/assets`). Has its own CLAUDE.md/changelog — follow them when editing there.
- `~/ralphTV-watch` — standalone mobile PWA player (hls.js). Not the primary surface.

## Environment variables
Full tables per service in ARCHITECTURE.md. Never add a `VITE_*` secret — anything `VITE_` ships to the browser.

## Project-specific conventions
- All five services deploy from `main` on Railway. Root `railway.json` is shared config; Node services pin `builder: DOCKERFILE` in their own `<svc>/railway.json` — don't remove those.
- Frontend build must use `npm install --include=dev` (root `nixpacks.toml`) because `NODE_ENV=production` strips vite. If a frontend change "doesn't deploy", check the build log for `vite: not found`.
- AWS SDK pinned to exact `3.920.0` in backend/transcoder (3.729+ broke presigned browser uploads). Keep it pinned.
- Postgres on Railway needs `ssl: { rejectUnauthorized: false }`.
- Auth: mutating routes go through `requireWrite`. Streamer control is proxied via backend `/streamer/control/*`; never reintroduce a browser-side streamer token.
- Schedule writes are optimistic-concurrency (`If-Match` version) and broadcast over WS topic `schedule:<channel>:<week>:<day>`.
- Streamer state (`RUNNING`) is in-memory; `restoreDesiredState()` re-reads `stream_actions` on boot so redeploys don't leave the channel dark.
- Prototype-fast, harden-after applies, but this is a live channel: anything touching streamer/relay gets a staging test or an off-peak deploy.
