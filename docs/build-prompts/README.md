# Ralph TV build prompts — Sept 2026 next steps

Source: consultation with Matt (BBC iPlayer), 2026-09-10. Transcript:
https://notes.granola.ai/t/c0d8c2f9-bb12-4db1-8745-33ca66cd0a2f-00demib2

Each prompt is self-contained: paste the whole file into a fresh Claude Code
session in the repo it names. They were written after reading the current
code, so file paths and line numbers are real as of 2026-09-10 — but tell the
session to re-verify before editing.

| # | Prompt | Repo | Size | Why now |
|---|--------|------|------|---------|
| 01 | [Mobile player fix](01-mobile-player.md) | `~/ralph-world` | S–M | Brook flagged urgent. Likely the main driver of the 23s avg dwell time. |
| 02 | [Asset delete -> stream drop](02-asset-delete-stream-drop.md) | `~/ralphTV` | S | Live incident during the call. Also a real data bug regardless of the drop. |
| 03 | [Content metadata](03-content-metadata.md) | `~/ralphTV` | M | Unlocks search, filtering, collections, and the "warm-up" editorial layer Matt described. ~75 items to backfill. |
| 04 | [Analytics](04-analytics.md) | both | Phase A: S, Phase B: M–L | CDN can't give session time. Phase A is GA events (quick); Phase B is an owned dashboard. |

## Suggested order

1. **02** first — it's small, it's a live-channel bug, and the investigation
   half tells us whether the drop was the delete or something else.
2. **01** — biggest audience impact per hour of work.
3. **04 Phase A** — ship the GA events before doing anything else to the
   player so the next change is measurable.
4. **03** — needs a short decision from Brook/Nicola on the genre list before
   the backfill runs (the prompt proposes one).
5. **04 Phase B** — only once A has run for a couple of weeks and we know
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

## Not covered here (manual / non-build)

- **Broadcaster logins for Matt and Nicola.** Nicola currently uses Chris's
  login. Backend seeds one admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`; there's
  no user-management endpoint. Quickest path: a one-off script that inserts
  into `users` with a bcrypt hash (see how the seed does it in
  `backend/src/index.js`), or — if they're on the Ralph.World CMS — the SSO
  bridge (`/#token=<JWT>`) already works and just needs their CMS accounts.
- **Live event pipeline** (OBS -> RTMP -> relay, private staging URL) is
  the top roadmap item but needs Chris's sign-off and a real event to test
  against. Worth its own prompt once the relay publish key
  (`RELAY_PUBLISH_KEY`, opt-in today) is configured.
