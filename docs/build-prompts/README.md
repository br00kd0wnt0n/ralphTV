# Ralph TV build prompts — Sept 2026 next steps

Source: consultation with Matt (BBC iPlayer), 2026-09-10. Transcript:
https://notes.granola.ai/t/c0d8c2f9-bb12-4db1-8745-33ca66cd0a2f-00demib2

Each prompt is self-contained: paste the whole file into a fresh Claude Code
session in the repo it names. They were written after reading the current
code, so file paths and line numbers are real as of 2026-09-10 — but tell the
session to re-verify before editing.

| # | Prompt | Repo | Size | Why now |
|---|--------|------|------|---------|
| 01 | [Mobile player fix + vertical content](01-mobile-player.md) | `~/ralph-world` (+ `~/ralphTV` for Part C) | M | **Priority (Brook, 2026-09-15).** Rotate-closes-the-player bug, plus Part C: portrait clips are padded to a 405px strip and shown `contain` on phones. |
| 02 | [Stream-control safety + asset delete](02-asset-delete-stream-drop.md) | `~/ralphTV` | S | Investigation done (it was Stop/Start clicks, not the delete). Build half remains. |
| 03 | [Content metadata](03-content-metadata.md) | `~/ralphTV` | M | Unlocks search, filtering, collections, and the "warm-up" editorial layer Matt described. ~75 items to backfill. |
| 04 | [Analytics](04-analytics.md) | both | Phase A: S, Phase B: M–L | CDN can't give session time. Phase A is GA events (quick); Phase B is an owned dashboard. |
| 05 | [Sandbox broadcaster + player](05-sandbox-environment.md) | `~/ralphTV`, then `~/ralph-world` | M | On-demand copy of the stack on a `sandbox` Railway environment, own S3 prefix. The "staging test" `CLAUDE.md` asks for has never existed. |

## Suggested order

1. **01** — Brook's priority. Parts A/B need only ralph-world and Chrome
   device mode; Part C (vertical) is best proven on the sandbox with a
   throwaway portrait clip, so start 01 and 05 together if there are two
   sessions.
2. **05** — everything below it becomes testable before it hits the channel.
3. **02** — small; its streamer change goes through the sandbox first.
4. **04 Phase A** — ship the GA events before doing anything else to the
   player so the next change is measurable.
5. **03** — needs a short decision from Brook/Nicola on the genre list before
   the backfill runs (the prompt proposes one).
6. **04 Phase B** — only once A has run for a couple of weeks and we know
   what questions the dashboard actually needs to answer.

## Conventions every prompt assumes

- Read the repo's `CLAUDE.md` first; ralphTV's `AGENTS.md` size budgets are
  enforced by `npm run lint`.
- ralphTV deploys all five services from `main` on Railway on every push.
  Anything touching streamer/relay goes out off-peak (London evening / US
  morning) — the channel is 24/7.
- Global context (`~/context-base/CLAUDE.md`): full files not snippets,
  error handling even in prototypes, flag env vars / manual config at the
  end, don't add dependencies without flagging.
- End the session by updating `changelog.md` in whichever repo changed.
- Railway CLI gotchas (learned 2026-09-11): `railway logs --build --service X`
  shows the last **successful** build by default — pass the failed
  deployment's id (`railway status --json` → `latestDeployment.id`) to see
  why a build failed. `railway run` from a laptop cannot reach
  `postgres.railway.internal`; anything that needs the database runs inside
  Railway or via the dashboard.

## Not covered here (manual / non-build)

- **Broadcaster logins.** `nicola@ralph.world` and `guestadmin@ralph.world`
  were created 2026-09-11 (admin role). **Matt's is still to do.** The
  working path is Railway → Database → Data → `users` → add row: `email`,
  `password_hash` (bcrypt — generate locally, see `backend/scripts/create-user.mjs`
  for the hash call; never a raw password), `role=admin`; leave `id` and
  `created_at` blank. `npm run create:user` exists but only works from inside
  Railway (private DB hostname). If they're on the Ralph.World CMS, the SSO
  bridge (`/#token=<JWT>`) also works.
- **Live event pipeline** (OBS -> RTMP -> relay, private staging URL) is
  the top roadmap item but needs Chris's sign-off and a real event to test
  against. Worth its own prompt once the relay publish key
  (`RELAY_PUBLISH_KEY`, opt-in today) is configured.
