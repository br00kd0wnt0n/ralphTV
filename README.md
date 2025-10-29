# ralphTV V1 (Frontend Wireframe)

A Vite + React + TypeScript app that provides a drag-and-drop weekly content scheduler for video/audio assets. This is a frontend-only wireframe to validate UX and interactions.

## Features
- Drag and drop across Uploaded Content and 7-day schedule
- Supports video and audio file uploads (local, in-memory via Object URLs)
- Color-coded by content type
- Reorder within library and within/between days
- Remove a scheduled item by dragging it back into the library area

## Getting Started

1. Install dependencies:
   `npm install`

2. Start dev server:
   `npm run dev`

3. Build for production:
   `npm run build`

4. Preview production build:
   `npm run preview`

### Config (env)
- `VITE_API_BASE_URL` — backend base URL (optional for mock mode)
- `VITE_USE_MOCK_UPLOADS` — `true` (default) uses mocked uploads; set `false` to hit real API
- `VITE_USE_BACKEND_SCHEDULE` — `false` (default); set `true` to load/save schedule via backend
- `VITE_API_AUTH_TOKEN` — optional Bearer token for API calls
- `VITE_CHANNEL` — schedule channel key (default `default`)
- `VITE_WEEK` — schedule week key (default `current`)
- `VITE_REALTIME_URL` — optional WS URL for realtime updates

## Notes
- This is frontend-only. Files are not persisted; uploads live in memory. Refresh clears state.
- Drag from Library to a day to schedule; drag within a day to reorder; drag between days to move; drag from a day to Library to remove.
- Uses `react-beautiful-dnd` for DnD.

### Uploads (V1)
- Uploads are routed through `UploadBar` using a service in `src/api/upload.ts`.
- In mock mode, progress is simulated and assets are created with Object URLs for preview.
- When integrated, the flow will call `/uploads/init` → PUT to pre-signed S3 URL → `/uploads/complete`.

### Multipart Uploads
- The API client supports multipart uploads using pre-signed part URLs returned by `/uploads/init`.
- Progress aggregates per-part; completion calls `/uploads/complete` with `{ uploadId, parts: [{ partNumber, etag }] }`.
- Mock mode currently returns single-part responses for simplicity.

## Backend Integration (Future)
- File storage (CDN/Object Storage)
- Vimeo API integration / player
- Metadata management and duration probing
- Transcoding pipeline
- User authentication

## Structure
- `src/components/ContentScheduler.tsx` — main scheduler component
- `src/components/UploadBar.tsx` — upload UI with progress
- `src/styles/content-scheduler.css` — scheduler styles
- `src/App.tsx`, `src/main.tsx` — app entry
- `src/state/models.ts`, `src/state/schedule.ts` — types and pure helpers
- `src/state/persistence.ts` — localStorage save/load for assets (metadata only) and schedule
- `src/api/upload.ts`, `src/config.ts` — upload service and configuration
- `src/api/schedule.ts` — versioned schedule API client (GET/PUT with If-Match)

Previous prototype files (`content-scheduler.jsx`, `content-scheduler.css` at repo root) are superseded by `src/components/ContentScheduler.tsx` and `src/styles/content-scheduler.css`.
