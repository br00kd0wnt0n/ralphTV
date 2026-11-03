// Read-side SQL for the /stats page. Pure SQL over viewer_events (+ assets for names).
// Every query takes the same three params: $1 from-date, $2 to-date (inclusive, both
// YYYY-MM-DD in London time) and $3 the surface filter ('tv' | 'home' | 'embed' | 'all').
import { HEARTBEAT_SEC } from './analytics-ingest.js';

export const TZ = 'Europe/London';
const HB = HEARTBEAT_SEC;

// A "viewer" is a visit that watched at least this long; anything shorter is a bounce.
export const VIEWER_MIN_SEC = 10;

const EV = `ev as (
  select * from viewer_events
   where ts >= ($1::date)::timestamp at time zone '${TZ}'
     and ts <  ($2::date + 1)::timestamp at time zone '${TZ}'
     and ($3::text = 'all' or surface = $3)
)`;

// One row per visit (= one page load).
const S = `s as (
  select session_id,
    min(ts) as started,
    max(coalesce(watch_sec, 0)) as watch_sec,
    bool_or(event = 'play_start') as played,
    bool_or(event = 'unmute') as unmuted,
    bool_or(event = 'tap_to_watch') as tapped,
    bool_or(event = 'gate_shown') as gated,
    bool_or(event = 'gate_shown' and props->>'on_arrival' = 'true') as gated_on_arrival,
    bool_or(event = 'subscribe_click') as subscribed,
    bool_or(event = 'offline_view') as saw_offline,
    (array_agg(device order by ts))[1] as device,
    (array_agg(browser order by ts))[1] as browser,
    (array_agg(props order by ts) filter (where event = 'page_view'))[1] as pv
  from ev group by session_id
)`;

const V = VIEWER_MIN_SEC;

const SQL = {
  kpis: `with ${EV}, ${S}
    select count(*)::int as visits,
      count(*) filter (where watch_sec >= ${V})::int as viewers,
      count(*) filter (where watch_sec < ${V})::int as bounced,
      coalesce(sum(watch_sec), 0)::int as watch_sec,
      coalesce(percentile_cont(0.5) within group (order by watch_sec) filter (where watch_sec >= ${V}), 0)::float as median_viewer_sec,
      count(*) filter (where device = 'desktop' and played)::int as desktop_played,
      count(*) filter (where device = 'desktop' and played and unmuted)::int as desktop_unmuted,
      count(*) filter (where device <> 'desktop' and not saw_offline)::int as mobile_visits,
      count(*) filter (where device <> 'desktop' and tapped)::int as mobile_tapped,
      count(*) filter (where gated)::int as gated,
      count(*) filter (where gated_on_arrival)::int as gated_on_arrival,
      count(*) filter (where subscribed)::int as subscribe_clicks,
      count(*) filter (where saw_offline)::int as offline_visits
    from s`,

  funnel: `with ${EV}, ${S}
    select device,
      count(*)::int as arrived,
      count(*) filter (where played)::int as started,
      count(*) filter (where watch_sec >= ${V})::int as s10,
      count(*) filter (where watch_sec >= 30)::int as s30,
      count(*) filter (where watch_sec >= 120)::int as s120,
      count(*) filter (where watch_sec >= 600)::int as s600
    from s group by device order by arrived desc`,

  daily: `with ${EV}, ${S}
    select to_char(started at time zone '${TZ}', 'YYYY-MM-DD') as day,
      count(*)::int as visits,
      count(*) filter (where watch_sec >= ${V})::int as viewers,
      coalesce(sum(watch_sec), 0)::int as watch_sec
    from s group by 1 order by 1`,

  hours: `with ${EV}
    select extract(hour from ts at time zone '${TZ}')::int as hour,
      (count(*) * ${HB})::int as watch_sec,
      count(distinct session_id)::int as viewers
    from ev where event = 'heartbeat' group by 1 order by 1`,

  sources: `with ${EV}, ${S}
    select coalesce(nullif(pv->>'utm_source', ''), nullif(pv->>'ref', ''), 'direct') as source,
      nullif(pv->>'utm_campaign', '') as campaign,
      count(*)::int as visits,
      count(*) filter (where watch_sec >= ${V})::int as viewers,
      coalesce(sum(watch_sec), 0)::int as watch_sec
    from s group by 1, 2 order by visits desc limit 20`,

  devices: `with ${EV}, ${S}
    select device, browser, count(*)::int as visits,
      count(*) filter (where watch_sec >= ${V})::int as viewers,
      coalesce(sum(watch_sec), 0)::int as watch_sec
    from s group by 1, 2 order by visits desc`,

  actions: `with ${EV}
    select event, coalesce(props->>'kind', '') as kind,
      count(*)::int as events, count(distinct session_id)::int as sessions
    from ev where event not in ('heartbeat', 'page_view', 'hidden', 'visible')
    group by 1, 2 order by sessions desc`,

  // Per-show: audience, watch time, exits and a 10-bucket audience curve across the clip.
  shows: `with ${EV},
    hb as (select session_id, asset_id, offset_sec, ts from ev where event = 'heartbeat' and asset_id is not null),
    per as (select asset_id, count(distinct session_id)::int as viewers, (count(*) * ${HB})::int as watch_sec from hb group by asset_id),
    last_hb as (select distinct on (session_id) session_id, asset_id, offset_sec from hb order by session_id, ts desc),
    exits as (
      select asset_id, count(*)::int as exits,
        percentile_cont(0.5) within group (order by offset_sec)::float as median_exit_sec
      from last_hb group by asset_id
    ),
    curve as (
      select hb.asset_id, least(9, floor(hb.offset_sec::float / a.duration_sec * 10))::int as b,
        count(distinct hb.session_id)::int as n
      from hb join assets a on a.id = hb.asset_id
      where a.duration_sec > 0 and hb.offset_sec is not null
      group by 1, 2
    )
    select p.asset_id,
      coalesce(regexp_replace(a.file_name, '\\.[^.]+$', ''), 'Deleted clip') as name,
      a.duration_sec, c.name as category, c.color as category_color,
      p.viewers, p.watch_sec, coalesce(e.exits, 0) as exits, e.median_exit_sec,
      (select coalesce(json_agg(json_build_object('b', cv.b, 'n', cv.n) order by cv.b), '[]'::json)
         from curve cv where cv.asset_id = p.asset_id) as curve
    from per p
    left join assets a on a.id = p.asset_id
    left join categories c on c.id = a.category_id
    left join exits e on e.asset_id = p.asset_id
    order by p.watch_sec desc limit 100`,
};

/** Everything the overview page needs, in parallel. */
export async function overview(pool, params) {
  const keys = ['kpis', 'funnel', 'daily', 'hours', 'sources', 'devices', 'actions'];
  const results = await Promise.all(keys.map((k) => pool.query(SQL[k], params)));
  const out = {};
  keys.forEach((k, i) => { out[k] = k === 'kpis' ? results[i].rows[0] : results[i].rows; });
  return out;
}

export async function shows(pool, params) {
  const { rows } = await pool.query(SQL.shows, params);
  return rows;
}

/** Who is watching right now: sessions with a heartbeat in the last LIVE_WINDOW seconds. */
export async function live(pool) {
  const LIVE_WINDOW = HB * 3;
  const { rows } = await pool.query(
    `with recent as (
       select distinct on (session_id) session_id, surface, device, asset_id
         from viewer_events
        where event = 'heartbeat' and ts > now() - make_interval(secs => $1)
        order by session_id, ts desc
     )
     select r.surface, r.device, r.asset_id,
       coalesce(regexp_replace(a.file_name, '\\.[^.]+$', ''), null) as name,
       count(*)::int as n
     from recent r left join assets a on a.id = r.asset_id
     group by 1, 2, 3, 4`,
    [LIVE_WINDOW]
  );
  const total = rows.reduce((t, r) => t + r.n, 0);
  return { total, windowSec: LIVE_WINDOW, rows };
}
