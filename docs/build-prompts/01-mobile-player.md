# Build prompt 01 — Fix the mobile Ralph TV player

**Repo:** `~/ralph-world` (the viewer-facing site) for parts A/B; Part C also
touches `~/ralphTV` (transcoder, backend `/now-playing`). Run this session
in ralph-world and open ralphTV alongside it.
**Persona:** Architect — improve what's there, don't rebuild the TV set.
**Also read:** `~/ralph-world/CLAUDE.md`, `components/tv/README.md`.

## Goal

Make watching Ralph TV on a phone work reliably: tap to watch, rotate freely,
sound toggles, exit returns you to the page. Today the landscape/fullscreen
behaviour is inconsistent and the average engagement time on the TV page is
23 seconds (GA, 171 views since 2026-08-16). We believe the mobile experience
is a large part of that number.

## What exists (verified 2026-09-10)

The mobile path lives in `components/tv/TVSet.tsx`:

- `isMobile` is `window.matchMedia('(max-width: 767px)')` (line ~108). Below
  768px the TV cutout renders a "Tap to watch" poster instead of the inline
  `LivePlayer`.
- `enterImmersive()` (line ~159) mounts a portal (`fixed inset-0`, `100dvw` x
  `100dvh`) with a second `LivePlayer`, then:
  - Android/desktop (`document.fullscreenEnabled` true): calls
    `requestFullscreen()` on the overlay element. Custom Schedule / Info /
    Mute buttons render inside it.
  - iPhone Safari (no element fullscreen): an effect calls
    `video.webkitEnterFullscreen()` once the video is mounted, i.e. Apple's
    native player takes over. `webkitendfullscreen` closes immersive.
- While immersive, an effect locks scroll and calls
  `screen.orientation.lock('landscape')` (line ~143).
- In portrait (non-iPhone-native path) a full-black "Rotate your device"
  screen covers the video at `z-40` (line ~1043). Audio keeps playing under it.
- `useEffect(() => { if (!isMobile) setImmersive(false) }, [isMobile])`
  (line ~126) closes immersive whenever the breakpoint says "not mobile".

`LivePlayer.tsx` owns hls.js; `hooks/useLiveStatus` drives `isLive`. The
stream URL comes from `/api/broadcaster/relay-url`.

## Hypotheses, ranked — verify before fixing

1. **Rotating to landscape kills immersive mode.** Most phones are wider than
   767px in landscape (iPhone 15: 852x393, Pixel 8: 915x412). Rotating flips
   the `(max-width: 767px)` query to false -> `isMobile` false -> the effect on
   line ~126 calls `setImmersive(false)`. The user does exactly what the
   "Rotate your device" screen asks and the player closes. This alone would
   explain "inconsistent landscape behaviour" and a very short dwell time.
   Fix direction: decide "mobile" once at entry (pointer coarse / touch, or
   `min(width,height) < 768`), not on the live width. Never exit immersive on
   a breakpoint change; only on explicit exit, fullscreen exit, or going
   offline.
2. **Orientation lock fires before fullscreen is granted.** `orientation.lock`
   only succeeds inside fullscreen on Android; the effect runs on
   `immersive` becoming true, before `requestFullscreen()` resolves, so it
   silently rejects. Chain it: `req.call(el).then(() => orientation.lock(...))`.
3. **The portrait "Rotate your device" wall is a dwell-time killer.** It
   blocks the picture entirely. Proposal: play letterboxed in portrait with a
   small dismissible "best in landscape" hint instead of a wall. This is a
   product call — implement it behind a prop default and flag it to Brook in
   the wrap-up rather than asking mid-session.
4. **iPhone native fullscreen edge cases.** `immersiveVideoReady` +
   `webkitEnterFullscreen` needs `readyState >= 1`; if the relay URL resolves
   slowly after the tap the gesture is lost and the user sees the CSS overlay
   with no way to get sound on (Apple's player owns audio in that path, and
   `hideMuteUi` may hide the only control). Check what the user sees when
   `iosNativeFs` is true but native fullscreen never opened.
5. **`100dvh` + address bar.** Confirm the overlay isn't being clipped on iOS
   Safari with the toolbar expanded; `dvh` is correct but check the
   `LivePlayer` `fit="contain"` box actually receives the height.

## Deliverables

1. **Repro notes first.** Use Chrome devtools device mode for the breakpoint
   hypothesis (rotate the emulated device), then confirm on at least one real
   iPhone and one Android if available. Record what happens on: tap ->
   rotate -> rotate back -> exit; and tap in landscape directly. Put the
   findings in the changelog entry.
2. Fix `TVSet.tsx` per the confirmed hypotheses. Keep the file's existing
   structure; it's already ~1090 lines, so if you add more than ~60 lines,
   extract the immersive overlay into `components/tv/ImmersivePlayer.tsx`.
3. Sound: the immersive Android path starts muted with an unmute button;
   confirm the first tap on that button actually unmutes (user gesture) and
   that volume persists via `ralph-tv-volume`.
4. Exit behaviour: leaving fullscreen by any route (Esc, back gesture, Apple
   "Done", our X button) returns to the page with the poster showing, no
   stuck scroll lock, no orphaned portal.
5. A Playwright mobile-emulation test (`e2e/`) covering: poster shown at
   390px; tap opens immersive; viewport rotate to 852x393 keeps immersive
   mounted. Use the existing `playwright.config.ts` device projects.

## Part C — vertical-aspect content (PRIORITY — Brook, 2026-09-15)

Portrait (9:16) clips look wrong on phones: a small picture with black on
every side. Brook's ask: look at the transcode for full-screen vertical, or
at least test the auto-zoom that removes the bars. Verified 2026-09-15:

- **The transcoder pads, it doesn't crop.** `transcoder/src/index.js:169`:
  `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:…:color=black`.
  A 1080x1920 source becomes a **405x720 strip** in the middle of the 16:9
  frame — 32% of the width, downscaled from 1080 to 405. Every player then
  receives that frame. `norm_width`/`norm_height` on `assets` are the
  *output* dims (always 1280x720), so they can't tell you the orientation;
  the transcoder's ffprobe (line ~112) only probes the audio stream, so the
  source dims are never stored.
- **The immersive overlay uses `fit="contain"`** (`LivePlayer` prop doc:
  "'contain' for the full-bleed immersive overlay so nothing is cropped").
  On a portrait phone that fits the whole 16:9 frame into a 9:16 viewport:
  the strip ends up ~1/3 of the screen width. That is the black Brook sees.
- **The auto-zoom already exists — in the other player.**
  `~/ralphTV/src/components/embed/LiveEmbedPlayer.tsx:11`
  `detectContentAspect()` samples edge pixels of the decoded frame on a
  canvas, and if the left/right edges are black (pillarbox) switches the
  container to 9/16 with `object-fit: cover`. It needs
  `crossOrigin="anonymous"` on the `<video>` (line 221) or `getImageData`
  throws and the catch silently returns `'landscape'`. ralph-world's
  `components/tv/LivePlayer.tsx` has neither the detection nor `crossOrigin`.
- **Cover-fit alone gets most of the way.** Cover-fitting the 1280x720 frame
  into a 390x844 viewport scales by 844/720 and shows the centre 333px of
  the frame — i.e. 333 of the strip's 405px (82%). So for a portrait clip on
  a portrait phone, `fit="cover"` ≈ the auto-zoom, minus a 9% crop each side.
- **Resolution is the ceiling nobody can zoom past.** The strip is 405px
  wide at source; a 390-CSS-px phone at 3x DPR is 1170px — a ~2.9x upscale.
  Zooming fixes the framing, not the softness.

### Options, ranked

1. **Metadata-driven zoom (do this).** Transcoder: probe the video stream
   too, store `src_width`/`src_height` (migration `0008`), and keep them on
   `assets`. Backend `/now-playing`: add `aspect: 'portrait' | 'landscape'`
   (portrait when `src_height > src_width`) to `current` and `next`.
   ralph-world `TVSet`/immersive: when `current.aspect === 'portrait'` and
   the viewport is portrait, use `fit="cover"`; optionally crop exactly to
   the strip with a CSS `scale()` derived from `src_width/src_height` so no
   content is lost. Landscape clips keep `contain`. Falls over cleanly:
   missing metadata → today's behaviour. Backfill `src_*` for the ~75
   existing assets by re-probing `s3_key` (a one-off script run inside
   Railway) — no re-transcode needed.
2. **Test the pixel auto-zoom first (1-hour spike).** Port
   `detectContentAspect` into `LivePlayer` behind a prop, add
   `crossOrigin="anonymous"`, and try it against a real portrait clip.
   Confirm the relay/Bunny path actually returns `Access-Control-Allow-Origin`
   on `.ts` segments (the relay sends `*` always; check Bunny forwards it).
   Known weaknesses to note: fades/dark scenes false-positive, canvas
   tainting fails silently, it polls per segment. It is the fallback for
   option 1, not the plan.
3. **Blur-fill instead of black pad at transcode** (like a social-media
   post). Cosmetic win on the desktop TV set, but it destroys the pixel
   detection in option 2 and does nothing for mobile resolution. Product
   call; don't do it by default.
4. **Full-resolution vertical.** Not possible inside one 16:9 stream. It
   would need the transcoder to also write a 720x1280 copy for portrait
   sources, the streamer to publish a second `_vert` RTMP stream, and a
   second HLS playlist — effectively a second channel, and the streamer
   copy-mode concat requires uniform params per stream. **Scope it in the
   changelog (effort, egress, ABR interaction); do not build it here.**

### Deliverables for Part C

- Reproduce with a portrait clip. Use the sandbox (prompt 05) if it exists;
  otherwise a throwaway upload scheduled off-peak, deleted afterwards.
- Option 2 spike, findings in the changelog (does it fire? on the Bunny
  path? how fast?).
- Option 1 end-to-end: migration, transcoder probe + backfill script,
  `/now-playing.aspect`, `TVSet` fit switch. Fire the GA events from prompt
  04 if they have landed.
- Option 4 scoping note.

## Optional part B — broadcaster `/embed` player

`~/ralphTV/src/components/embed/LiveEmbedPlayer.tsx` is the iframe-able
player (used by third-party embeds, not by ralph-world). Its fullscreen is
`container.requestFullscreen()` only — no iPhone `webkitEnterFullscreen`
path, no orientation handling. Only do this if part A lands quickly: add the
iOS native-fullscreen fallback and `playsInline` is already set. Respect the
220-LOC component budget (`npm run lint` in ralphTV).

## Acceptance criteria

- On a 390px-wide phone viewport: tap -> video plays within 3s of `isLive`.
- Rotating to landscape and back never closes the player.
- Portrait shows the picture (letterboxed) — or, if Brook keeps the wall,
  the wall is dismissible.
- iPhone Safari: native fullscreen opens on the first tap; exiting it returns
  to the poster; a second tap works.
- Android Chrome: true fullscreen, custom controls visible, unmute works.
- No console errors from `orientation.lock` or `requestFullscreen` rejections
  (catch them, but log once at debug level so we can see them in Sentry
  breadcrumbs).
- Portrait clip on a portrait phone: the picture fills the screen height
  with no black beyond the clip's own edges; landscape clips are unchanged
  (letterboxed). Switching between a portrait and a landscape asset
  mid-stream updates the fit within one `/now-playing` poll.
- `/now-playing` returns `aspect` for `current` and `next`; existing assets
  are backfilled.
- `npm run lint && npm run test` pass; the new e2e test passes.

## Constraints

- Don't change the desktop TV set rendering or the SVG geometry.
- Don't add dependencies.
- The preview/subscribe gate logic (`previewEnabled`, `PREVIEW_KEY`) must be
  untouched — immersive still drops back to the poster when the gate fires.
- ralph-world has Sentry; don't swallow errors silently, breadcrumb them.

## Wrap-up

- Update `~/ralph-world/changelog.md` with repro findings, what changed, and
  the portrait-wall decision that needs Brook's confirmation.
- If prompt 04 Phase A has already landed, fire `ralphtv_immersive_enter` /
  `ralphtv_immersive_exit` from the new code paths.
- List any manual steps (none expected — no env vars).
