# Build prompt 01 — Fix the mobile Ralph TV player

**Repo:** `~/ralph-world` (the viewer-facing site). Run this session there.
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
