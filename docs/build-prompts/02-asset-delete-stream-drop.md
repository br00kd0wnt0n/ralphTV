# Build prompt 02 — Stream-control safety + harden asset delete

**Repo:** `~/ralphTV`. Run this session here.
**Persona:** Architect.
**Also read:** `CLAUDE.md`, `ARCHITECTURE.md` (Streamer + schema sections),
`changelog.md` entry for 2026-09-10 (the investigation result below).

## Background — the 2026-09-10 "delete glitch", resolved

During the consultation call the stream dropped and it was attributed to
deleting an unscheduled asset. The logs say otherwise (investigated the
same evening; evidence in changelog.md):

- `stream_actions` has **stop 16:27:30, start 16:27:35, restart 16:28:04,
  stop 16:28:14, restart 16:28:19** (London), all `brook@ralph.world`, each
  row doubled (frontend `logStreamAction` + backend proxy both write).
- Streamer log has `Cleaning up streamer... / Sending SIGINT to ffmpeg` at
  exactly those times; the first one killed an ffmpeg that had run 16h26m.
  Each rebuild took ~6–10s, so the channel flapped for ~50s.
- Backend logged no `asset delete error` (the delete succeeded cleanly);
  no rollover, crash, container restart, or relay event in the window.

Brook's reconstruction: his connection glitched, the broadcaster preview
showed the offline card, and he hit Stop/Start/Restart to "bring it back".
The streamer's ffmpeg progress lines are healthy (`fps=24 speed=1x`) right
up to the first SIGINT, so the stream was fine and the clicks caused the
outage. The player can't distinguish "relay stopped" from "I can't reach
the relay": a fatal hls.js `NETWORK_ERROR` sets `state='error'` in
`src/hooks/useHls.ts:145` and the same offline card renders either way.
The delete was coincidental. Four real weaknesses this exposed:

1. **The UI invites the wrong reflex.** When the *operator's* connection
   drops, the preview and status badges look identical to a dead stream,
   and nothing points at the evidence that it isn't (`Session: 16h26m`,
   relay `lastUpdated`). Fix in Deliverable A.
2. Stop/Restart are one un-confirmed click away from taking a 24/7 channel
   dark, and nothing on screen says who did it or when it happened until
   `stream-actions/last` refreshes.
3. `DELETE /assets/:id` (`backend/src/index.js:663`) claims "cascade will
   handle scheduled_items" — false. `0001_init.sql:59` has no `ON DELETE`,
   so deleting a *scheduled* asset 500s, and `LibraryPanel.tsx:238` removes
   it optimistically and only `console.error`s. There's also no audit line
   for a successful delete, which is why we couldn't time this one.
4. Every control action is logged twice.

## Deliverables

### A. Make stream control harder to fat-finger and easy to audit
- **Distinguish "you're offline" from "the stream is offline".** In
  `useHls.ts`, a fetch *failure* (network error, timeout) is not the same
  as a 404/`streaming:false`. Track it separately (`reachable: boolean`)
  and expose it; the preview (`PreviewPane` / `HlsPlayer` / `LiveEmbedPlayer`)
  shows a "Reconnecting — can't reach the relay from this device" state
  instead of the offline card, and keeps retrying. Same for the ON AIR
  badge in `StreamerControls.tsx`: if `streamerStatus()` throws, show
  "status unknown" (grey), never OFF AIR.
- `StreamerControls.tsx`: Stop and Restart get a confirm step that names
  the consequence AND the current evidence: "The streamer reports ON AIR,
  session 16h26m, relay last segment 3s ago. Take the channel off air?
  Viewers will see the offline card for ~15s." If the backend is
  unreachable, the confirm says so and suggests checking your connection
  first. Test Signal likewise. Start stays one-click. Keep the component
  under its LOC budget — a tiny `useConfirm()` or inline `window.confirm`
  is fine.
- Backend proxy `POST /streamer/control/:action` (line ~1305): forward the
  actor as `X-Actor: <email>`; streamer logs
  `==> control/<action> by <email>` before acting, so the streamer log is
  self-explanatory next time.
- Remove the duplicate row: drop the frontend's `logStreamAction()` calls in
  `StreamerControls.tsx` (the proxy already records every action). Keep
  `POST /stream-actions/log` for now; nothing else uses it — note it as
  removable.
- Show the last action inline: the "Stream stopped at … by …" line already
  exists (line ~147); make sure it refreshes immediately after a click
  rather than on the next poll.

### B. Harden asset delete
- `DELETE /assets/:id`: inside a transaction, select `schedule_items`
  referencing the asset (join `schedules` for `week/day`). If referenced
  and no `?force=1` → `409 { message, scheduledOn: [{ week, day, position }] }`.
  With `force=1` → delete those items, renumber `position` per schedule,
  bump each `schedules.version`, commit, then `broadcast()` each
  `schedule:<channel>:<week>:<day>` in the same shape as the PUT handler
  (line ~383). Then delete the asset. S3 stays untouched. Fix the comment.
- Log one line on success: `asset deleted { id, file_name, by, forced, removedFrom }`.
- Frontend: `deleteAsset()` surfaces the 409 body; on 409 show a second
  confirm naming the days and retry with `force=1`; on any failure restore
  the asset in state and show an inline error. Extract a `useDeleteAsset`
  hook if `LibraryPanel.tsx` tips over 220 LOC.
- No schema change (NO ACTION is the behaviour we want).

### C. Optional — shorten the restart gap
`/control/restart` stops ffmpeg, waits 800ms, then the main loop re-fetches
the playlist and re-downloads before the next ffmpeg starts (~6–10s dark in
the logs above, 15–20s as viewers see it via the relay's 12s idle
threshold). A soft reload that builds the new concat list first and only
then swaps ffmpeg would close most of it. Scope it in the changelog; build
it only if Brook says so.

## Acceptance criteria

- Stop/Restart/Test Signal prompt before acting; Start does not.
- One `stream_actions` row per click; the streamer log names the actor.
- Deleting an unscheduled asset: 200, gone, S3 untouched, audit line logged.
- Deleting a scheduled asset: 409 with days; force path shrinks those days,
  positions contiguous, second open tab updates without reload.
- Failed delete restores the asset in the UI with a visible error.
- `npm run lint` passes; streamer `/status.sessionStartedAt` is unchanged
  across a test delete (`scripts/watch-stream.sh` prints nothing new).

## Constraints

- Don't cascade-delete schedule slots. Don't call the streamer from the
  delete route.
- Test the 409/force flow with a throwaway upload, not real content.
- Streamer changes deploy the streamer: do it off-peak, and confirm
  `restoreDesiredState` resumes the channel after the redeploy.

## Wrap-up

- Changelog entry; update ARCHITECTURE.md for the 409/force contract and
  the `X-Actor` header.
- No env vars expected.
