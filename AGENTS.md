# ralphTV Agent Guide

Scope: This file applies to the `ralphTV/` directory and its subfolders.

## Architecture & Organization
- Keep UI components small and focused. Split when a component reaches ~200 LOC or has multiple responsibilities.
- Put domain types and pure helpers under `src/state/` (e.g., `models.ts`, `schedule.ts`).
- Prefer pure functions for schedule math and DnD transforms; keep components thin.
- Co-locate styles in `src/styles/` and import from components.
- Avoid adding dependencies unless necessary for V1 scope.

## Size Budgets (enforced by `npm run lint:size`)
- TSX components: max ~220 LOC (hard fail at 260).
- TS modules: max ~280 LOC (hard fail at 320).
- CSS files: max ~320 LOC (hard fail at 380).
- If a file approaches the soft limit, refactor or split before adding features.

## DnD Rules of Thumb
- Library → Day: create a scheduled item that references the asset.
- Day ↔ Day: move the scheduled item.
- Day → Library: remove the scheduled item (library remains unchanged).

## Persistence & Backends
- V1 is frontend-only. Any persistence should be `localStorage` with import/export JSON.
- Defer backend integrations (Vimeo/CDN/auth/transcoding) to follow-up milestones.

## Coding Style
- TypeScript strict mode is required.
- Keep components presentational; move logic into small helpers.
- No inline large comments; prefer concise docstrings above exported functions.

