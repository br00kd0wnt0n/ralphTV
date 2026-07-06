-- 2026-07-06 — per-asset description text for the Ralph TV "show info"
-- overlay on the ralph-world side. Editors set this in the broadcaster
-- admin UI; it's returned in the /assets list and joined into the
-- schedule feed on the consumer's side so TeletextShowInfo can render
-- it as the current-show blurb.
--
-- Idempotent — column added with IF NOT EXISTS so re-running is safe.

alter table assets add column if not exists description text;
