import type { Kpis } from '../../api/stats';
import { duration, pct, watchTotal } from '../../state/statsFormat';

interface Tile {
  label: string;
  value: string;
  note: string;
}

function Tiles({ tiles, hero }: { tiles: Tile[]; hero?: boolean }) {
  return (
    <div className={hero ? 'stats-tiles stats-tiles-hero' : 'stats-tiles'}>
      {tiles.map((t) => (
        <div key={t.label} className="stats-tile">
          <div className="stats-tile-label">{t.label}</div>
          <div className="stats-tile-value">{t.value}</div>
          <div className="stats-tile-note">{t.note}</div>
        </div>
      ))}
    </div>
  );
}

/** Headline numbers, then the player signals that explain them. */
export default function KpiRow({ k }: { k: Kpis }) {
  const headline: Tile[] = [
    { label: 'Visits', value: String(k.visits), note: 'page loads of the player' },
    { label: 'Viewers', value: String(k.viewers), note: `${pct(k.viewers, k.visits)} watched 10s or more` },
    { label: 'Bounced', value: pct(k.bounced, k.visits), note: `${k.bounced} left before 10s of video` },
    { label: 'Watch time', value: watchTotal(k.watch_sec), note: 'playing, tab in view' },
    { label: 'Typical viewer', value: duration(k.median_viewer_sec), note: 'median watch, viewers only' },
  ];
  const signals: Tile[] = [
    {
      label: 'Sound on (desktop)',
      value: pct(k.desktop_unmuted, k.desktop_played),
      note: `${k.desktop_unmuted} of ${k.desktop_played} who got muted autoplay`,
    },
    {
      label: 'Tapped to watch (mobile)',
      value: pct(k.mobile_tapped, k.mobile_visits),
      note: `${k.mobile_tapped} of ${k.mobile_visits} phone/tablet visits`,
    },
    {
      label: 'Gated on arrival',
      value: pct(k.gated_on_arrival, k.visits),
      note: `${k.gated_on_arrival} guests whose free view had already run out`,
    },
    {
      label: 'Subscribe clicks',
      value: String(k.subscribe_clicks),
      note: `from ${k.gated} visits that saw the gate`,
    },
  ];
  return (
    <>
      <Tiles tiles={headline} hero />
      <Tiles tiles={signals} />
    </>
  );
}
