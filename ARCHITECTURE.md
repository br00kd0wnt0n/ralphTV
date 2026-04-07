# Ralph TV Architecture

## System Overview

Ralph TV is a multi-service video streaming platform that schedules, normalizes, and broadcasts video content to RTMP destinations (YouTube, Twitch, etc.) while serving an HLS preview. A React frontend manages content and scheduling; four backend services handle API, encoding, streaming, and relay.

```
                         +----------------+
                         |  React Frontend |
                         |  (Vite / TS)    |
                         +--------+-------+
                                  |
                       REST + WebSocket
                                  |
                         +--------v-------+         +------------------+
                         |  Backend API   | ------> |  PostgreSQL      |
                         |  (Express)     |         |  (Railway)       |
                         +--------+-------+         +------------------+
                                  |
                      +-----------+-----------+
                      |                       |
              +-------v------+        +-------v-------+
              |  Transcoder  |        |   Streamer    |
              |  (FFmpeg)    |        |   (FFmpeg)    |
              +--------------+        +-------+-------+
                      |                       |
                Cloudflare R2           RTMP push
                (S3-compat)                   |
                                      +-------v-------+
                                      |    Relay       |
                                      | (Nginx RTMP)   |
                                      +---+-------+---+
                                          |       |
                                     HLS out   RTMP push
                                    (:8080)    (:1935)
                                                  |
                                         YouTube / Twitch / etc.
```

---

## Services

### 1. Frontend (React + TypeScript)

| | |
|---|---|
| **Stack** | React 18, TypeScript 5, Vite 5 |
| **Port** | 4173 (preview) / platform-assigned |
| **Entry** | `src/main.tsx` -> `src/App.tsx` |

**Routes:**
| Path | Component | Auth |
|------|-----------|------|
| `/embed/*` | `LiveEmbedPlayer` | None |
| `/*` | `ContentScheduler` | JWT (unless `VITE_DISABLE_AUTH=true`) |

**Key libraries:**
- `hls.js` ^1.6.14 -- HLS playback
- `react-beautiful-dnd` ^13.1.1 -- drag-and-drop scheduling
- `@vimeo/player` ^2.24.0 -- Vimeo preview
- `axios` ^1.7.7 -- HTTP client

**Source layout:**
```
src/
  components/      21 React components
  api/             10 API client modules
  auth/            Auth context + axios interceptor
  state/           Models, schedule logic, localStorage persistence
  hooks/           useHls, useDurationBackfill
  realtime/        WebSocket client (RealtimeClient class)
  utils/           JWT decoder, media utilities
  styles/          11 CSS files
  config.ts        Env-var-driven configuration
```

---

### 2. Backend API (Express)

| | |
|---|---|
| **Stack** | Node.js 20, Express 4, `pg`, `ws` |
| **Port** | 3000 (default) |
| **Source** | `backend/src/index.js`, `backend/src/feed.js` |
| **Docker** | `node:20-alpine` |

**Authentication:** JWT tokens (2h expiry) + optional service token via `X-Service-Token` header or `Authorization: Bearer`.

#### API Endpoints

**Public (no auth):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz`, `/health` | Health check |
| GET | `/feed/rss` | Podcast RSS 2.0 feed (requires `R2_PUBLIC_URL`) |
| GET | `/api/relay/status` | Proxy relay streaming status |
| GET | `/api/relay/destinations` | Proxy relay push destinations |
| GET | `/api/relay/healthz` | Proxy relay health |
| GET | `/api/system/status` | Aggregated status of all services |

**Authenticated:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Login (email + password), returns JWT |
| GET | `/api/protected` | Auth test endpoint |
| POST | `/uploads/init` | Initialize S3 upload (single or multipart) |
| POST | `/uploads/complete` | Complete upload, create asset + normalization job |
| GET | `/uploads/part-url` | Presigned URL for multipart upload part |
| GET | `/schedule/:channel/:week/:day` | Get schedule for a day |
| PUT | `/schedule/:channel/:week/:day` | Replace schedule (optimistic concurrency via `If-Match`) |
| PATCH | `/schedule/:channel/:week/:day` | Partial schedule update (add/remove/move ops) |
| GET | `/assets` | List all assets with tags |
| GET | `/assets/:id/url` | Presigned download URL (prefers normalized) |
| POST | `/assets/:id/duration` | Update duration |
| POST | `/assets/:id/name` | Update name |
| POST | `/assets/:id/tags` | Set tags (batch upsert) |
| POST | `/assets/:id/category` | Set category |
| DELETE | `/assets/:id` | Delete asset (DB only, S3 retained) |
| GET | `/categories` | List categories |
| POST | `/categories` | Create category |
| PATCH | `/categories/:id` | Update category |
| DELETE | `/categories/:id` | Delete category |
| POST | `/stream-actions/log` | Log start/stop/restart action |
| GET | `/stream-actions/last` | Get last stream action |
| GET | `/feed/:channel/:week/:day/playlist` | Day playlist (optional `?withUrls=1`) |
| GET | `/feed/:channel/:week/:day/now` | Current playback pointer |
| GET | `/status/:channel/:week/today` | Redirects to today's status |
| GET | `/status/:channel/:week/:day` | Current item + pointer |
| GET | `/debug/normalized` | Normalization status of all assets |
| GET | `/debug/schedule/:channel/:week/:day` | Schedule integrity check |
| GET | `/api/debug/on-air` | Legacy on-air debug info |

**Admin only (auth + `role=admin`):**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/normalize/backfill` | Enqueue normalization for unnormalized assets |
| POST | `/admin/normalize/reprocess` | Re-normalize all video assets |

#### WebSocket Protocol

Runs on the same HTTP server. Clients connect and subscribe to topics.

**Allowed topic prefixes:** `schedule:`, `categories`, `stream-actions`

**Client -> Server:**
```json
{ "type": "subscribe", "topic": "schedule:default:current:Monday" }
{ "type": "unsubscribe", "topic": "categories" }
```

**Server -> Client (broadcasts):**
```json
// Schedule change
{ "topic": "schedule:default:current:Monday", "doc": { "version": 5, "items": [...] } }

// Category CRUD
{ "topic": "categories", "event": "created", "category": { "id": "...", "name": "...", "color": "..." } }
{ "topic": "categories", "event": "deleted", "id": "..." }
```

**Limits:** 20 topics per client. Optional token auth via `?token=<jwt>` query param.

#### Playback Pointer (`computePointer`)

Determines which asset is currently playing based on schedule start time and elapsed seconds.

**Inputs:** playback mode (`loop` | `playthru`), start time (`HH:MM`), durations array, current time.

**Behavior:**
- **Loop mode:** elapsed time wraps around total duration (`elapsed % total`)
- **Playthru mode:** no wrap; returns `{ ended: true }` once past total duration
- Returns `{ index, offsetSec }` indicating current item and position within it

---

### 3. Streamer (FFmpeg)

| | |
|---|---|
| **Stack** | Node.js 20, raw `http.createServer`, FFmpeg |
| **Port** | 3001 (default) |
| **Source** | `streamer/src/index.js`, `streamer/src/config.js` |
| **Docker** | `node:20-bullseye-slim` + FFmpeg |

The streamer fetches the daily playlist from the backend API, downloads each video from S3, and streams to an RTMP target via FFmpeg.

**Streaming modes:**
| Mode | Description |
|------|-------------|
| **Sequential** | Stream items one-by-one with optional slate between |
| **Batch** | Concatenate items into one FFmpeg process |
| **Continuous** | Build a looped concat list, single long-running FFmpeg |
| **Copy mode** | For pre-normalized files: `-c:v copy -c:a copy` (no re-encoding) |
| **Encode mode** | Full re-encode with scaling, bitrate control, optional logo overlay |

**Features:**
- Logo overlay (PNG or looping MP4) with configurable scale and opacity
- Silent audio generation for videos without audio tracks
- Slate video playback between items and during idle
- Test signal generation (`testsrc` + sine wave)
- SIGINT/SIGTERM graceful shutdown with SIGKILL fallback
- Retry logic with configurable max retries

**HTTP Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/`, `/healthz` | Health check |
| GET | `/status` | `{ running, current, sessionStartedAt, sessionTimeSec }` |
| POST | `/control/start` | Start streaming |
| POST | `/control/stop` | Stop streaming + cleanup |
| POST | `/control/restart` | Stop + delayed restart |
| POST | `/control/test-signal?seconds=N` | Stream test pattern |
| GET | `/debug/playlist` | Current playlist JSON |
| GET | `/debug/config` | Streamer config (truncated RTMP target) |
| GET | `/debug/ffmpeg` | FFmpeg availability check |

---

### 4. Transcoder (FFmpeg)

| | |
|---|---|
| **Stack** | Node.js 20, `pg`, `@aws-sdk/client-s3`, FFmpeg |
| **Port** | 3002 (health only) |
| **Source** | `transcoder/src/index.js` |
| **Docker** | `node:20-bullseye-slim` + FFmpeg |

Headless worker that polls the `normalize_jobs` table for pending work.

**Pipeline:**
1. Claim next pending/failed job (atomic `UPDATE ... RETURNING`)
2. Download source from S3 (`s3_key`)
3. Probe for audio stream (`ffprobe`)
4. Normalize: scale to target resolution, pad with black bars, force keyframes, normalize audio (or generate silent track)
5. Upload normalized file to S3 (`normalized/{assetId}.mp4`)
6. Update asset record with `s3_key_norm`, `norm_status='ready'`, resolution/fps/bitrate metadata
7. Clean up temp files

**Encoding defaults:**
| Setting | Default |
|---------|---------|
| Resolution | 1280x720 |
| FPS | 24 |
| Video bitrate | 2500k |
| Audio bitrate | 160k |
| Preset | ultrafast |
| Profile | high |
| Pixel format | yuv420p |

**Polling:** Adaptive backoff from 2s to 10s when idle. Resets to 2s after processing a job.

**Health endpoint:** `GET /healthz` returns `{ ok, lastPollAt }`. Reports unhealthy if no poll in 30s.

---

### 5. Relay (Nginx RTMP)

| | |
|---|---|
| **Stack** | Nginx + `ngx_rtmp_module` |
| **Ports** | 8080 (HTTP), 1935 (RTMP) |
| **Source** | `relay/nginx.conf.template`, `relay/entrypoint.sh`, `relay/monitor-stream.sh` |
| **Docker** | `debian:bullseye-slim` + nginx + libnginx-mod-rtmp |

**RTMP server** (port 1935):
- Application: `live`
- Accepts incoming RTMP streams from streamer
- Pushes to up to 5 destinations (`RELAY_PUSH_1` through `RELAY_PUSH_5`)
- Generates HLS segments at `/tmp/hls/` (1s fragments, 5s playlist)

**HTTP server** (port 8080):
| Path | Description |
|------|-------------|
| `/hls/*` | HLS segments and manifest (`stream.m3u8`) |
| `/api/status` | `{ streaming: bool, lastUpdated: ISO }` |
| `/api/destinations` | `{ destinations: ["youtube", "twitch", ...] }` |
| `/healthz` | Returns `200 ok` |

**Config generation:** `entrypoint.sh` uses `envsubst` to expand `nginx.conf.template` with runtime values. Push destinations are extracted from `RELAY_PUSH_*` env vars and platform names parsed from RTMP URLs.

**Stream monitor:** Background script (`monitor-stream.sh`) checks if `stream.m3u8` was modified in the last 12 seconds and updates `/tmp/api/status.json`. Backs off to 15s polling when idle.

---

## Database Schema (PostgreSQL)

Managed via sequential migrations in `backend/migrations/`.

```
users
  id             uuid PK
  email          text UNIQUE NOT NULL
  password_hash  text NOT NULL
  role           text DEFAULT 'admin'
  created_at     timestamptz DEFAULT now()

assets
  id             uuid PK
  file_name      text NOT NULL
  mime_type      text NOT NULL
  size           bigint NOT NULL
  s3_key         text NOT NULL          -- raw upload path
  file_type      text NOT NULL          -- 'video' | 'audio' | 'unknown'
  uploaded_at    timestamptz DEFAULT now()
  vimeo_reference text
  duration_sec   int
  thumbnail_url  text
  category_id    uuid FK -> categories
  s3_key_norm    text                   -- normalized video path
  norm_status    text DEFAULT 'pending' -- pending | processing | ready | failed
  norm_error     text
  norm_width     int
  norm_height    int
  norm_fps       int
  norm_bitrate   int

tags
  id             uuid PK
  name           text UNIQUE NOT NULL

asset_tags
  asset_id       uuid FK -> assets (CASCADE)
  tag_id         uuid FK -> tags (CASCADE)
  PK (asset_id, tag_id)

categories
  id             uuid PK
  name           text UNIQUE NOT NULL
  color          text DEFAULT '#8e8e8e'

schedules
  id             uuid PK
  channel        text NOT NULL
  week           text NOT NULL
  day            text NOT NULL
  timezone       text DEFAULT 'UTC'
  version        int DEFAULT 0          -- optimistic concurrency
  playback_mode  text DEFAULT 'loop'    -- 'loop' | 'playthru'
  play_start     text                   -- 'HH:MM'
  updated_by     uuid FK -> users
  updated_at     timestamptz DEFAULT now()
  UNIQUE (channel, week, day)

schedule_items
  id             uuid PK
  schedule_id    uuid FK -> schedules (CASCADE)
  position       int NOT NULL
  asset_id       uuid FK -> assets
  start_time     int
  duration_sec   int DEFAULT 0
  UNIQUE (schedule_id, position)

normalize_jobs
  id             uuid PK
  asset_id       uuid FK -> assets
  status         text DEFAULT 'pending' -- pending | processing | done | failed
  attempts       int DEFAULT 0
  last_error     text
  created_at     timestamptz DEFAULT now()
  updated_at     timestamptz DEFAULT now()

stream_actions
  id             uuid PK
  action         text NOT NULL          -- 'start' | 'stop' | 'restart'
  user_email     text NOT NULL
  created_at     timestamptz DEFAULT now()
```

---

## Storage

| Store | Purpose | Access |
|-------|---------|--------|
| **Cloudflare R2** (S3-compatible) | Raw uploads (`raw/{userId}/{fileId}/{name}`) and normalized videos (`normalized/{assetId}.mp4`) | AWS SDK via presigned URLs |
| **PostgreSQL** (Railway) | All metadata, schedules, jobs, users | `pg` connection pool |

---

## Environment Variables

### Backend
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `JWT_SECRET` | Production | `dev-secret-change-me` | JWT signing key (fatal if missing in production) |
| `AWS_REGION` | For uploads | -- | S3/R2 region |
| `S3_BUCKET_UPLOADS` | For uploads | -- | Bucket name |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | -- | `production` enables strict SSL + JWT requirement |
| `CORS_ALLOWED_ORIGINS` | No | `*` | Comma-separated origins |
| `SERVICE_TOKEN` | No | -- | Internal service auth token |
| `RELAY_URL` | No | -- | Relay base URL for proxying |
| `STREAMER_URL` | No | -- | Streamer base URL for status |
| `ADMIN_EMAIL` | No | -- | Auto-seed admin user on startup |
| `ADMIN_PASSWORD` | No | -- | Auto-seed admin password |
| `R2_PUBLIC_URL` | For RSS | -- | Public R2 base URL for enclosure URLs |
| `RSS_TITLE` | No | `RalphTV` | Podcast feed title |
| `RSS_DESCRIPTION` | No | `RalphTV Video Podcast` | Podcast feed description |
| `RSS_LINK` | No | `https://ralphtv.com` | Podcast feed link |
| `RSS_LANGUAGE` | No | `en` | Feed language |
| `RSS_CATEGORY` | No | `TV & Film` | iTunes category |
| `S3_PREFIX` | No | `raw` | S3 key prefix |
| `PRESIGN_TTL_MINUTES` | No | `10` | Presigned URL lifetime |
| `MULTIPART_THRESHOLD_MB` | No | `100` | Multipart upload threshold |

### Frontend (Vite)
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | -- | Backend API URL |
| `VITE_USE_MOCK_UPLOADS` | `true` | Skip real S3 uploads |
| `VITE_USE_BACKEND_SCHEDULE` | `false` | Use backend vs localStorage |
| `VITE_API_AUTH_TOKEN` | -- | Fallback auth token (client-visible) |
| `VITE_CHANNEL` | `default` | Schedule channel |
| `VITE_WEEK` | `current` | Schedule week |
| `VITE_REALTIME_URL` | -- | WebSocket URL |
| `VITE_STREAMER_BASE_URL` | -- | Streamer service URL |
| `VITE_RELAY_BASE_URL` | -- | Relay service URL |
| `VITE_FALLBACK_GIF_URL` | -- | Offline fallback image |
| `VITE_DISABLE_AUTH` | `false` | Skip auth wrapper |

### Streamer
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_BASE_URL` | Yes | -- | Backend API URL |
| `RTMP_TARGET` | Yes | -- | Target RTMP URL |
| `API_AUTH_TOKEN` | No | -- | Bearer token for backend |
| `CHANNEL` | No | `default` | Schedule channel |
| `WEEK` | No | `current` | Schedule week |
| `VIDEO_BITRATE` | No | `2500k` | Encoding bitrate |
| `AUDIO_BITRATE` | No | `160k` | Audio bitrate |
| `FPS` | No | `24` | Frame rate |
| `GOP` | No | `24` | Keyframe interval |
| `RESOLUTION` | No | `1280x720` | Output resolution |
| `PRESET` | No | `ultrafast` | FFmpeg encoding preset |
| `LOGO_ENABLE` | No | `false` | Enable logo overlay |
| `LOGO_PATH` | No | `/app/assets/logo.png` | Logo file path |
| `LOGO_SCALE` | No | `200` | Logo width in pixels |
| `LOGO_OPACITY` | No | `0.8` | Logo transparency |
| `STREAMER_CONTINUOUS` | No | `false` | Single-process continuous mode |
| `STREAMER_FORCE_RTMPS` | No | `false` | Upgrade `rtmp://` to `rtmps://` |
| `STREAMER_SLATE_URL` | No | -- | Slate video URL |
| `STREAMER_SLATE_BETWEEN_SEC` | No | `0` | Slate duration between items |
| `STREAMER_SLATE_IDLE_SEC` | No | `30` | Slate duration when idle |
| `STREAMER_MIN_SEC` | No | `0` | Skip items shorter than N seconds |
| `STREAMER_MAX_RETRIES` | No | `1` | Max retries per item |
| `STREAMER_DAY` | No | -- | Override current day name |

### Transcoder
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `AWS_REGION` | Yes | -- | S3/R2 region |
| `S3_BUCKET_UPLOADS` | Yes | -- | Bucket name |
| `TARGET_WIDTH` | No | `1280` | Output width |
| `TARGET_HEIGHT` | No | `720` | Output height |
| `FPS` | No | `24` | Frame rate |
| `VIDEO_BITRATE` | No | `2500k` | Video bitrate |
| `AUDIO_BITRATE` | No | `160k` | Audio bitrate |
| `PRESET` | No | `ultrafast` | FFmpeg preset |

### Relay
| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_HTTP_PORT` | `8080` | HTTP port |
| `RELAY_RTMP_PORT` | `1935` | RTMP port |
| `RELAY_PUSH_1` .. `RELAY_PUSH_5` | -- | RTMP push destinations |
| `NGINX_WORKER_PROCESSES` | `auto` | Nginx workers |

---

## Deployment

All services deploy as independent Docker containers on **Railway**. No `docker-compose.yml` -- each service has its own `Dockerfile` and Railway service configuration.

| Service | Base Image | Port(s) | Healthcheck |
|---------|-----------|---------|-------------|
| Backend | `node:20-alpine` | 3000 | `GET /healthz` |
| Streamer | `node:20-bullseye-slim` | 3001 | `GET /healthz` |
| Transcoder | `node:20-bullseye-slim` | 3002 | `GET /healthz` |
| Relay | `debian:bullseye-slim` | 8080, 1935 | `GET /healthz` |

**Startup sequence:**
1. Backend runs migrations (`npm run migrate`) then starts Express
2. Transcoder validates env vars, starts poll loop + health server
3. Streamer starts HTTP control server, waits for `/control/start`
4. Relay generates nginx config from env vars, starts nginx + monitor script

**Graceful shutdown:**
- Backend: closes HTTP server, WebSocket clients, database pool (5s timeout)
- Streamer: SIGINT to FFmpeg, SIGKILL fallback after 5s, temp file cleanup
- Transcoder: closes database pool, stops health server
