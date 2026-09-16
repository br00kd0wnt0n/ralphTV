# ralphTV Railway Deployment Guide

## Architecture Overview

ralphTV requires **TWO Railway services**:
1. **Backend API** (Express + PostgreSQL)
2. **Frontend** (Vite React SPA)

---

## Step 1: Deploy Backend API

### 1.1 Login to Railway
```bash
railway login
```

### 1.2 Create Backend Service

From the **backend directory**:
```bash
cd /Users/BD/ralphTV/backend
railway init
```

Select: "Create new project" → Name it "ralphTV"

### 1.3 Add PostgreSQL Database

In the Railway dashboard:
1. Click your "ralphTV" project
2. Click "+ New" → "Database" → "PostgreSQL"
3. Railway will automatically set `DATABASE_URL` environment variable

### 1.4 Set Backend Environment Variables

```bash
# In /Users/BD/ralphTV/backend directory
railway variables set JWT_SECRET="6twd0+v8qnhGSjz97nIwH0KPKZhSSiScVC+0/WlPdYlgMuOS3oDX/GaHSrSS15mSl6V8fKwzRnnXn7dr+NS/kw=="
railway variables set AWS_REGION="us-east-1"
railway variables set AWS_ACCESS_KEY_ID="YOUR_AWS_KEY_ID"
railway variables set AWS_SECRET_ACCESS_KEY="YOUR_AWS_SECRET_KEY"
railway variables set S3_BUCKET_UPLOADS="your-bucket-name"
railway variables set CORS_ALLOWED_ORIGINS="*"
railway variables set NODE_ENV="production"
```

**Note**: Replace AWS values with your actual credentials

### 1.5 Deploy Backend
```bash
railway up
```

### 1.6 Run Database Migrations

After deployment, run migrations:
```bash
railway run npm run migrate
```

### 1.7 Create Admin User

Seed the admin user with your credentials:
```bash
railway run --service backend sh -c 'ADMIN_EMAIL=brook@ralph.world ADMIN_PASSWORD=admin123! npm run seed:admin'
```

Or interactively:
```bash
railway run npm run seed:admin
# Enter: brook@ralph.world
# Enter: admin123!
```

### 1.8 Get Backend URL

```bash
railway domain
```

This will show your backend URL (e.g., `https://ralphtv-backend-production.up.railway.app`)

**Save this URL** - you'll need it for the frontend!

---

## Step 2: Deploy Frontend

### 2.1 Add Frontend Service

In Railway dashboard:
1. Go to your "ralphTV" project
2. Click "+ New" → "GitHub Repo"
3. Connect your repository: `https://github.com/br00kd0wnt0n/ralphTV.git`
4. Select root directory (not /backend)
5. Name it "ralphTV-frontend"

**OR** from the root directory:
```bash
cd /Users/BD/ralphTV
railway link  # Link to existing ralphTV project
```

### 2.2 Set Frontend Environment Variables

**CRITICAL**: Replace `YOUR_BACKEND_URL` with the URL from Step 1.8

```bash
# In /Users/BD/ralphTV (root directory)
railway variables set VITE_API_BASE_URL="https://ralphtv-backend-production.up.railway.app"
railway variables set VITE_USE_MOCK_UPLOADS="false"
railway variables set VITE_USE_BACKEND_SCHEDULE="true"
railway variables set VITE_CHANNEL="default"
railway variables set VITE_WEEK="current"
```

### 2.3 Configure Build Settings

In Railway dashboard for frontend service:
- **Build Command**: `npm run build`
- **Start Command**: `npm run preview`

### 2.4 Deploy Frontend

If connected to GitHub, it will auto-deploy.

Or manually:
```bash
railway up
```

### 2.5 Get Frontend URL

```bash
railway domain
```

This is your app URL (e.g., `https://ralphtv-production.up.railway.app`)

---

## Step 3: Test the Deployment

### 3.1 Test Backend Health

Visit: `https://your-backend-url.railway.app/healthz`

Should return: `{"ok": true}`

### 3.2 Test Frontend

Visit: `https://your-frontend-url.railway.app`

### 3.3 Test Login

1. Go to your frontend URL
2. Click "Sign in"
3. Enter:
   - **Email**: `brook@ralph.world`
   - **Password**: `admin123!`
4. Should successfully log in!

---

## Environment Variables Reference

### Backend Service

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | Auto-set by Railway Postgres | ✅ Yes |
| `JWT_SECRET` | Generated secure secret | ✅ Yes |
| `AWS_REGION` | `us-east-1` (or your region) | ✅ Yes |
| `AWS_ACCESS_KEY_ID` | Your AWS key | ✅ Yes |
| `AWS_SECRET_ACCESS_KEY` | Your AWS secret | ✅ Yes |
| `S3_BUCKET_UPLOADS` | Your S3 bucket name | ✅ Yes |
| `CORS_ALLOWED_ORIGINS` | `*` (or specific domains) | Optional |
| `NODE_ENV` | `production` | Optional |
| `PORT` | Auto-set by Railway | Auto |

### Frontend Service

| Variable | Value | Required |
|----------|-------|----------|
| `VITE_API_BASE_URL` | Your backend URL | ✅ Yes |
| `VITE_USE_MOCK_UPLOADS` | `false` | ✅ Yes |
| `VITE_USE_BACKEND_SCHEDULE` | `true` | ✅ Yes |
| `VITE_CHANNEL` | `default` | Optional |
| `VITE_WEEK` | `current` | Optional |
| `VITE_REALTIME_URL` | WebSocket URL | Optional |

---

## Optional Security Hardening (opt-in)

These features are **disabled until you set the env var**, so existing deploys keep
working. Turn them on once you've pasted the secrets into Railway. Example secrets are
pre-generated below — generate your own with `openssl rand -hex 24` for real use.

### A. Relay RTMP publish auth

By default the relay accepts an RTMP publish on `rtmp://<relay>/live/<name>` from
**anyone** who can reach it — meaning a stranger could push into your stream and get
re-broadcast to your YouTube/Twitch keys. Enabling this requires every publisher to
present a shared key.

Set on the **relay** service:
```bash
railway variables set RELAY_PUBLISH_KEY="4314a9d555492d77757e7363f6a4929e7b097870045bc2f4"
# Point the relay at the backend's validation endpoint (Railway private networking):
railway variables set RELAY_PUBLISH_AUTH_URL="http://<backend-internal-host>:<port>/relay/publish-auth"
```
Set the **same key** on the **backend** service so it can validate:
```bash
railway variables set RELAY_PUBLISH_KEY="4314a9d555492d77757e7363f6a4929e7b097870045bc2f4"
```
Then update every publisher to append the key as a query arg on the publish URL
(the HLS playback path is unchanged — the key never appears in viewer URLs):
```bash
# Streamer service:
railway variables set RTMP_TARGET="rtmp://<relay-host>:1935/live/stream?key=4314a9d555492d77757e7363f6a4929e7b097870045bc2f4"
# OBS: Server = rtmp://<relay-host>:1935/live , Stream Key = stream?key=4314a9d5...
```
With `RELAY_PUBLISH_AUTH_URL` unset, ingest stays open (current behaviour).

### B. Streamer control-endpoint auth

The streamer's `/control/start|stop|restart|test-signal` endpoints are unauthenticated
by default — anyone who reaches the port can stop the broadcast. The admin UI calls
these **through the backend** (`/streamer/control/*`), which authenticates the admin's
JWT and then forwards the request to the streamer using a server-side token. The token
never reaches the browser.

Set the **same token** on **both** the streamer and the backend:
```bash
# Streamer service — makes it enforce the token on /control/*:
railway variables set STREAMER_CONTROL_TOKEN="2177cd9ea76fac161a4431dec31dfb6b44d209294110c168"

# Backend service — used to call the streamer on the admin's behalf:
railway variables set STREAMER_CONTROL_TOKEN="2177cd9ea76fac161a4431dec31dfb6b44d209294110c168"
```
The backend also needs `STREAMER_URL` set to the streamer's base URL (it already uses
this for system-status checks). No frontend variable or rebuild is required.

With `STREAMER_CONTROL_TOKEN` unset on the streamer, control endpoints stay open
(current behaviour); the backend proxy still works (it just forwards without a token).

### Security env reference

| Service | Variable | Purpose | Required |
|---------|----------|---------|----------|
| Relay | `RELAY_PUBLISH_KEY` | Shared key publishers must present | Opt-in |
| Relay | `RELAY_PUBLISH_AUTH_URL` | Backend endpoint that validates publishes | Opt-in |
| Backend | `RELAY_PUBLISH_KEY` | Same key; validates `/relay/publish-auth` | Opt-in |
| Streamer | `RTMP_TARGET` | Must include `?key=<RELAY_PUBLISH_KEY>` when auth on | Opt-in |
| Streamer | `STREAMER_CONTROL_TOKEN` | Token required on `/control/*` | Opt-in |
| Backend | `STREAMER_CONTROL_TOKEN` | Same token; backend forwards control as the admin | Opt-in |
| Backend | `STREAMER_URL` | Streamer base URL the proxy calls | Required for control |

---

## Sandbox environment

Built 2026-09-16 (build prompt 05). An isolated copy of the whole stack for
trying content/scheduling/features without touching the 24/7 channel.
Railway environments are fully isolated — separate compute, separate private
network, separate database — so none of this can affect `production`.

**Login:** `https://ralphtv-frontend-sandbox.up.railway.app` —
`sandbox-admin@ralph.world` (password generated at setup time; ask Brook or
regenerate via `railway variables --service Backend --environment sandbox
--set "ADMIN_PASSWORD=<new>"` then redeploy Backend — see the link-switch
dance below).

**Service URLs:**

| Service | URL |
|---|---|
| Frontend | `https://ralphtv-frontend-sandbox.up.railway.app` |
| Backend | `https://backend-sandbox-f770.up.railway.app` |
| Streamer | `https://streamer-sandbox.up.railway.app` |
| Relay | `https://relay-sandbox.up.railway.app` |

### How it was built

1. `railway environment new sandbox --duplicate production` — creates a
   second environment with its own copy of every service, including a
   **brand-new Postgres instance** (confirmed empty: no tables at all
   immediately after creation; Backend's own migration run then created the
   schema fresh — `stream_actions`/`assets` both 0 rows, so
   `restoreDesiredState()` never had anything to auto-resume).
2. **Gotcha found immediately:** `--duplicate` copies `DATABASE_URL` as a
   **literal string**, not a live reference — so Backend/Transcoder in the
   new environment had the *old* production password pointed at the *new*
   database and crash-looped (`password authentication failed`). Fixed by
   reading the new Database service's actual current `DATABASE_URL` and
   setting that explicitly on Backend + Transcoder in `sandbox` only. If you
   duplicate an environment again, check this first —
   `railway logs --service Backend --environment sandbox` will show
   `28P01`/`auth_failed` if it's hit.
3. Regenerated fresh secrets for `sandbox` (`JWT_SECRET`, `SERVICE_TOKEN`,
   `STREAMER_CONTROL_TOKEN`, `ADMIN_PASSWORD`) and a distinct
   `ADMIN_EMAIL=sandbox-admin@ralph.world` — the duplicate had copied
   production's real admin email + password verbatim, which would have let
   the production password work on the sandbox. Verified after: production
   creds return 401 against the sandbox backend.
4. Set per-service, sandbox only (see prompt 05's table for the full list):
   `S3_PREFIX=sandbox/raw`, `S3_PREFIX_NORM=sandbox/normalized`,
   `ENV_LABEL=sandbox`, `STREAMER_RESUME=false`, and each service's `*_URL`
   vars pointed at the sandbox domains above (Railway had already generated
   `-sandbox`-suffixed domains during duplication — `railway domain --service
   X` reported "already exists" and printed them).
5. Confirmed `RELAY_PUSH_1..5` were empty (nothing to accidentally push to a
   real YouTube/Twitch key).
6. **Still pending** (holding for an off-peak window — this part touches
   `main`): merge `feat/sandbox-env-phase-a` (`S3_PREFIX_NORM`, `ENV_LABEL`,
   the `VITE_ENV_LABEL` warning strip). Redeploys Backend/Transcoder/Frontend
   only — Streamer and Relay are never touched by that merge, so the live
   RTMP/HLS pipeline doesn't drop. Once merged: create a `sandbox` git branch
   from `main` and point every sandbox service's Source at it (Railway
   dashboard → Service → Settings → Source — the CLI has no way to change a
   service's tracked branch), so unmerged streamer/relay changes can be
   tested there before going to `main`.

### CLI gotchas learned doing this

- `railway redeploy` and `railway domain` don't take an `--environment` flag
  — they act on whichever environment the CLI is currently linked to
  (`railway status` shows it). `railway variables` **does** take
  `--environment`, so prefer that form when possible; for the two commands
  that don't, always `railway environment <name>` first, run `railway
  status` to confirm the switch took, do the command, then switch back and
  confirm again. Never run either while unsure which environment is linked.
- `railway variables --set ... --skip-deploys` lets you stage several
  variable changes across services before triggering one deliberate
  redeploy round, rather than each `--set` kicking off its own rebuild.

---

## Troubleshooting

### Login fails with "Authentication failed"
- Check backend logs: `railway logs --service backend`
- Verify admin user was seeded: `railway run --service backend npm run seed:admin`
- Verify credentials: `brook@ralph.world` / `admin123!`

### CORS errors
- Set `CORS_ALLOWED_ORIGINS` in backend to your frontend URL
- Or use `*` for development

### "No token provided" errors
- Check `VITE_API_BASE_URL` is set correctly in frontend
- Verify axios is using the base URL (check browser network tab)

### Database connection errors
- Ensure PostgreSQL service is running in Railway dashboard
- Check `DATABASE_URL` is set in backend service

### S3 upload errors
- Verify AWS credentials are correct
- Check S3 bucket exists and is accessible
- Verify bucket CORS policy allows uploads

---

## Quick Command Reference

```bash
# Backend deployment
cd backend
railway login
railway init
railway variables set KEY="value"
railway up
railway run npm run migrate
railway run npm run seed:admin
railway domain
railway logs

# Frontend deployment
cd ..  # back to root
railway link
railway variables set VITE_API_BASE_URL="https://..."
railway up
railway domain

# View logs
railway logs --service backend
railway logs --service frontend
```

---

## Security Notes

- ✅ JWT secret is cryptographically secure (512-bit)
- ✅ Passwords are hashed with bcrypt
- ✅ Database connections use SSL
- ⚠️ Consider restricting CORS in production
- ⚠️ Rotate AWS keys regularly
- ⚠️ Use Railway secrets for sensitive values

---

## Next Steps

1. [ ] Deploy backend with PostgreSQL
2. [ ] Run migrations
3. [ ] Seed admin user
4. [ ] Deploy frontend with `VITE_API_BASE_URL`
5. [ ] Test login
6. [ ] Configure custom domains (optional)
7. [ ] Set up Vimeo integration (optional)
