import { useMemo, useState } from 'react';
import type { ShowRow } from '../../api/stats';
import { duration, pct, watchTotal } from '../../state/statsFormat';

type SortKey = 'watch_sec' | 'viewers' | 'avg' | 'exits';

/** Audience across the clip in ten slices (start -> end), as a small line. */
function Curve({ curve }: { curve: ShowRow['curve'] }) {
  const W = 120;
  const H = 28;
  const pts = Array.from({ length: 10 }, (_, b) => curve.find((c) => c.b === b)?.n ?? 0);
  const max = Math.max(1, ...pts);
  const xy = pts.map((n, i) => [4 + (i * (W - 8)) / 9, H - 3 - (n / max) * (H - 6)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${xy[9][0]},${H - 2} L${xy[0][0]},${H - 2} Z`;
  return (
    <svg className="stats-spark" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Audience by tenth of the show: ${pts.join(', ')}`}>
      <path d={area} className="stats-spark-area" />
      <path d={d} className="stats-spark-line" />
    </svg>
  );
}

function exitPoint(s: ShowRow): string {
  if (s.median_exit_sec == null || !s.exits) return '–';
  const at = duration(s.median_exit_sec);
  return s.duration_sec ? `${at} (${pct(s.median_exit_sec, s.duration_sec)})` : at;
}

export default function ShowsTable({ shows }: { shows: ShowRow[] }) {
  const [sort, setSort] = useState<SortKey>('watch_sec');
  const rows = useMemo(() => {
    const val = (s: ShowRow) => (sort === 'avg' ? s.watch_sec / Math.max(1, s.viewers) : s[sort]);
    return [...shows].sort((a, b) => val(b) - val(a));
  }, [shows, sort]);

  if (!shows.length) return <p className="stats-empty">No one watched a clip in this range.</p>;

  const th = (key: SortKey, label: string) => (
    <th className="num">
      <button type="button" className={sort === key ? 'on' : ''} onClick={() => setSort(key)}>
        {label}{sort === key ? ' ↓' : ''}
      </button>
    </th>
  );

  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th>Show</th>
            <th className="num">Length</th>
            {th('viewers', 'Viewers')}
            {th('watch_sec', 'Watch time')}
            {th('avg', 'Per viewer')}
            {th('exits', 'Left during')}
            <th className="num">Typical exit</th>
            <th>Audience, start → end</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.asset_id}>
              <td className="stats-show-name">
                <i style={{ background: s.category_color || 'var(--viz-muted)' }} title={s.category || 'No category'} />
                <span>{s.name}</span>
              </td>
              <td className="num">{duration(s.duration_sec)}</td>
              <td className="num">{s.viewers}</td>
              <td className="num">{watchTotal(s.watch_sec)}</td>
              <td className="num">{duration(s.watch_sec / Math.max(1, s.viewers))}</td>
              <td className="num">{s.exits}</td>
              <td className="num">{exitPoint(s)}</td>
              <td>{s.duration_sec ? <Curve curve={s.curve} /> : <span className="stats-muted">no length</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
