import type { ActionRow, DeviceRow, SourceRow } from '../../api/stats';
import { actionLabel, pct, watchTotal } from '../../state/statsFormat';

interface BarRow {
  key: string;
  label: string;
  value: number;
  extra: string[];
}

/** Ranked list: label, an inline bar scaled to the largest value, then extra columns. */
function BarTable({ rows, head }: { rows: BarRow[]; head: string[] }) {
  if (!rows.length) return <p className="stats-empty">Nothing yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stats-table-wrap">
      <table className="stats-table stats-bartable">
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={i ? 'num' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <div className="stats-bar-label">{r.label}</div>
                <div className="stats-bar-track"><span className="stats-bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
              </td>
              <td className="num">{r.value}</td>
              {r.extra.map((x, i) => <td key={i} className="num">{x}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourcesTable({ rows }: { rows: SourceRow[] }) {
  return (
    <BarTable
      head={['Source', 'Visits', 'Watched', 'Watch time']}
      rows={rows.map((r) => ({
        key: `${r.source}|${r.campaign ?? ''}`,
        label: r.campaign ? `${r.source} · ${r.campaign}` : r.source,
        value: r.visits,
        extra: [pct(r.viewers, r.visits), watchTotal(r.watch_sec)],
      }))}
    />
  );
}

export function DevicesTable({ rows }: { rows: DeviceRow[] }) {
  return (
    <BarTable
      head={['Device · browser', 'Visits', 'Watched', 'Watch time']}
      rows={rows.map((r) => ({
        key: `${r.device}|${r.browser}`,
        label: `${r.device} · ${r.browser}`,
        value: r.visits,
        extra: [pct(r.viewers, r.visits), watchTotal(r.watch_sec)],
      }))}
    />
  );
}

export function ActionsTable({ rows, visits }: { rows: ActionRow[]; visits: number }) {
  return (
    <BarTable
      head={['Action', 'Visits', 'Of all visits']}
      rows={rows.map((r) => ({
        key: `${r.event}|${r.kind}`,
        label: actionLabel(r.event, r.kind),
        value: r.sessions,
        extra: [pct(r.sessions, visits)],
      }))}
    />
  );
}
