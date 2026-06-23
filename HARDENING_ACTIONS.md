# Hardening — owner action items

The code-level weaknesses from the full sweep are fixed and on `main`. The items
below need a person/AWS/Railway action and can't be done in code. Ordered by priority.

## Do now
1. **Rotate the admin passwords.** The deleted `backend/scripts/seed-both-admins.mjs`
   committed `admin123!` for `brook@ralph.world` and `chris@ralph.world` to git history.
   Set strong `ADMIN_PASSWORD`, re-run `npm run seed:admin`, and update the CMS's
   `BROADCASTER_ADMIN_PASSWORD` (the SSO bridge logs in with it). Consider scrubbing
   history (BFG/filter-repo) since the password is in past commits.
2. **Set `JWT_TTL=12h`** on the backend service (uploads/long sessions outliving the
   old 2h token — see the upload incident).
3. **S3 lifecycle rule — abort incomplete multipart uploads.** Failed/abandoned uploads
   accrue silent storage cost forever. Add to bucket `ralphtv` (us-east-1):
   ```
   AbortIncompleteMultipartUpload: DaysAfterInitiation = 1
   ```
4. **Enable Postgres backups / PITR** in Railway. A bad migration currently = total loss.

## Scaling guardrails (important before adding replicas)
5. **Backend must stay single-instance** until refactored. WebSocket subscriptions, the
   failed-login limiter, and rate state are all in-memory — at >1 replica, realtime
   schedule updates only reach clients on the same node and login throttling weakens.
   Keep backend `replicas=1`, or move those to Redis pub/sub + a shared counter first.
6. **Streamer is single-instance by design** (one RTMP key; two streamers double-push and
   corrupt the feed). Keep `replicas=1`.
7. **Transcoder CAN scale to N** — the `FOR UPDATE SKIP LOCKED` claim is safe. Scale this
   one if normalization is a bottleneck.

## Verify / lower priority
8. **Confirm `VITE_API_AUTH_TOKEN` is UNSET** in the frontend build. If set, a bearer
   token ships in the public JS bundle.
9. **IDOR / tenancy:** any admin can read/delete any asset by id. Fine for a single-tenant
   admin tool; revisit if you add non-admin or multi-tenant users (then scope by owner).
10. **Node 20 → 22** across service Dockerfiles before the AWS SDK Jan-2027 deadline; bump
    the relay base `bullseye-slim` → `bookworm-slim` and add a non-root `USER`.
11. **Observability:** no structured logs / request IDs / metrics today. Add pino + a
    request-id middleware + a `/metrics` endpoint for real incident debugging.
12. **react-beautiful-dnd** is unmaintained (schedule drag-and-drop). Migrate to the
    drop-in fork `@hello-pangea/dnd` when convenient.

## New env knobs added by the hardening (all have safe defaults)
- `MULTIPART_PART_MB` (100) — multipart part size; large files now split dynamically.
- `STREAMER_DOWNLOAD_TIMEOUT_MS` (120000), `STREAMER_MAX_DOWNLOAD_MB` (4096) — download caps.
- `MAX_NORMALIZE_ATTEMPTS` (5), `RETRY_BACKOFF_MINUTES` (1), `STUCK_JOB_MINUTES` (15) — transcoder.
- `LOGIN_MAX_FAILS` (10) — failed-login limiter threshold.
- `JWT_TTL` (2h) — token lifetime; recommend 12h (see item 2).
