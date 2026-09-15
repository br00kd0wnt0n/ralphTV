-- Source (pre-normalization) video dimensions, rotation-aware — so players can tell a
-- portrait clip (padded into the 16:9 frame at transcode, see transcoder normalize())
-- from a landscape one and zoom to the strip on phones. Probed by the transcoder on
-- each job; existing assets are backfilled by the transcoder while it is idle.
-- src_probe_error marks a failed probe so the backfill doesn't retry it forever.
alter table assets add column if not exists src_width int;
alter table assets add column if not exists src_height int;
alter table assets add column if not exists src_probe_error text;
