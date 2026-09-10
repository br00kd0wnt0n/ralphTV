# Build prompt 03 — Content metadata: genre, keywords, search, backfill

**Repo:** `~/ralphTV`. Run this session here.
**Persona:** Architect for schema/API, Frontend for the panel work.
**Also read:** `CLAUDE.md`, `ARCHITECTURE.md` (schema + `/assets` routes),
`AGENTS.md` (size budgets — this touches the biggest components).

## Goal

Every asset gets a genre and a set of keywords, editors can set them in the
broadcaster, the library can be searched and filtered by them, and the ~75
existing items are backfilled with a reviewable first pass. This is the
groundwork for automated collections, dedicated channels (comedy / music
feeds) and the "warm people up before they hit play" layer Matt described
from iPlayer — none of which can happen while the only metadata is a
filename, a category colour and an optional description.

## What exists (verified 2026-09-10)

- `assets` has: `file_name`, `description` (migration 0007, editable in
  `PreviewPane.tsx`, surfaced on ralph-world as the show blurb),
  `category_id` -> `categories(name, color)` (the schedule colour coding),
  `thumbnail_url`, `duration_sec`, normalization fields.
- **Tags already exist end to end in the backend:** `tags(id, name unique)`,
  `asset_tags(asset_id, tag_id)` (0001), `POST /assets/:id/tags` (batch
  upsert, `backend/src/index.js:455`), and `GET /assets` returns
  `tags: text[]` via `array_agg` (line ~566).
- **`src/components/TagEditor.tsx` exists but is mounted nowhere.** Grep
  confirms no imports. The UI for keywords was built and never wired in.
- `src/api/assets.ts` has `updateAssetDescription`, `setAssetCategory`,
  `updateAssetName` — check whether a `setAssetTags` client exists; add it
  if not.
- `LibraryPanel.tsx` computes `filteredAssets` (category filter today) and
  is close to its LOC budget.
- ralph-world reads `GET /assets` through `lib/broadcaster/client.ts`
  `normalizeAsset()` and currently only picks `file_name`, `duration_sec`,
  `thumbnail_url`, `description`. Anything we add is available to it for
  free once it reads the new fields.

## Model decision (make it, flag it in wrap-up)

Keep two distinct things:

- **Genre** — one controlled value per asset, used for channels and
  collections. New column `assets.genre text` with a constant list in
  `backend/src/genres.js` exported to the frontend via `GET /genres` (or a
  shared JSON). Proposed starter list, to confirm with Nicola/Tom:
  `comedy, music, documentary, talk, animation, short-film, ident, live-event, other`.
  Categories stay what they are (schedule colour groups) — don't merge them;
  they were set up early and "may need more rigour", but that's a separate
  editorial cleanup.
- **Keywords** — free-form, many per asset, via the existing `tags` tables.
  Normalise to lowercase, trimmed, max 40 chars, max 20 per asset.

Do **not** add a `keywords` JSON column alongside `tags` — one keyword model.

## Deliverables

### 1. Schema + API (backend)
- `backend/migrations/0008_asset_genre.sql`: `alter table assets add column
  if not exists genre text; create index if not exists idx_assets_genre on
  assets(genre);` — idempotent like 0007.
- `POST /assets/:id/genre` (`requireWrite`), validates against the list.
- `GET /genres` -> `{ genres: [...] }`.
- `GET /tags` -> `[{ name, count }]` ordered by count (for typeahead).
- Extend `GET /assets` with optional query params `q` (ILIKE on
  `file_name`/`description`), `genre`, `tag` (repeatable). Keep the
  no-param response identical so ralph-world and the streamer are unaffected.
- Include `genre` in the `GET /assets` select and in `/now-playing`'s
  `current`/`next` objects (line ~1362 builds them).
- Tag normalisation happens server-side in the existing `/assets/:id/tags`
  handler.

### 2. Broadcaster UI (frontend)
- Mount `TagEditor` in `PreviewPane.tsx` under the description field, wired
  to a new `setAssetTags()` in `src/api/assets.ts`, optimistic like the
  description save. Add a genre `<select>` next to it.
- Library search + filter in `LibraryPanel.tsx`: a text box (matches name,
  description, tags) and a genre dropdown alongside the existing category
  filter. Pure filter helpers go in `src/state/` per AGENTS.md; if
  `LibraryPanel.tsx` exceeds 220 LOC, extract `LibraryFilters.tsx`.
- Show genre + first two tags as small chips on each library row
  (`LibraryList.tsx`) so an editor can see coverage at a glance.
- `Asset` type in `src/state/models.ts` gains `genre?: string`, `tags` is
  probably already there — check.
- Run `npm run lint` — size budgets will bite here; split before adding.

### 3. Backfill script (one-off, reviewable)
`backend/scripts/backfill-metadata.mjs`:
- Reads all assets (name, description, category name, duration).
- For each, asks Claude for `{ genre, keywords[] }` given the genre list
  and a one-paragraph brief about Ralph TV (owned channel of a creative
  agency; comedy/music/culture; UK + US). Load the `claude-api` skill in the
  session to pick the current model id and use structured output; batch the
  75 items in one or a few calls to keep it cheap.
- `--dry-run` (default) writes `backfill-proposal.csv` with
  `id, file_name, current_genre, proposed_genre, current_tags, proposed_tags`.
  Nicola reviews/edits the CSV.
- `--apply <csv>` writes the reviewed values through the same SQL the
  endpoints use (or via the endpoints with a service token — pick whichever
  keeps validation in one place). Never overwrites a non-empty existing
  genre/tags unless `--overwrite`.
- Needs `ANTHROPIC_API_KEY` and `DATABASE_URL` locally; flag both.

### 4. Consumer hand-off (small)
- In `~/ralph-world/lib/broadcaster/client.ts` `normalizeAsset()` and
  `types.ts`, pass through `genre` and `tags` so the teletext Show Info can
  render a genre line. One-line change each; do it in the same session if
  ralph-world is clean, otherwise note it for that repo's next session.

## Acceptance criteria

- Migration runs on backend boot without touching existing rows.
- `GET /assets` with no params is byte-for-byte the same shape plus `genre`.
- Editor can set genre + tags on an asset in the preview pane; reload shows
  them; ralph-world `/api/broadcaster/assets` shows them within one poll.
- Library search finds an asset by a word in its description or a tag.
- Dry-run backfill produces a CSV for all assets with no writes;
  `--apply` updates only the rows in the CSV and reports counts.
- `npm run lint` passes; no new dependencies in the frontend. The script
  may use `@anthropic-ai/sdk` in `backend/` (flag it).

## Constraints

- Don't touch the schedule model or the streamer.
- Don't rename `categories` or change their semantics.
- Keep the genre list in one place; the frontend fetches it, doesn't
  duplicate it.
- The backfill is a proposal, not a decision — editorial owners are Nicola
  (day-to-day) and Tom Frain (EP). Don't `--apply` in the build session.

## Wrap-up

- Changelog entry with the model decision and the proposed genre list.
- Update `ARCHITECTURE.md`: schema block (`genre`), new endpoints, query
  params on `GET /assets`.
- Flag: `ANTHROPIC_API_KEY` for the script, the genre list needing sign-off,
  and the ralph-world pass-through if not done.
