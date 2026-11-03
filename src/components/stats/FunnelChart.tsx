import type { FunnelRow } from '../../api/stats';
import { DEVICE_ORDER, pct } from '../../state/statsFormat';

const STAGES: { key: keyof FunnelRow; label: string }[] = [
  { key: 'arrived', label: 'Arrived' },
  { key: 'started', label: 'Picture on' },
  { key: 's10', label: 'Watched 10s' },
  { key: 's30', label: '30s' },
  { key: 's120', label: '2 min' },
  { key: 's600', label: '10 min' },
];

const DEVICE_COLOR: Record<string, string> = { desktop: '--viz-1', mobile: '--viz-2', tablet: '--viz-3' };

/**
 * How far visits get, as a share of arrivals, one bar per device per stage.
 * Desktop autoplays muted so "Picture on" is near-automatic there; on phones it
 * needs a tap, which is why the device split matters.
 */
export default function FunnelChart({ rows }: { rows: FunnelRow[] }) {
  const devices = DEVICE_ORDER.map((d) => rows.find((r) => r.device === d)).filter(Boolean) as FunnelRow[];
  if (!devices.length) return <p className="stats-empty">No visits in this range.</p>;
  return (
    <div className="stats-funnel">
      <div className="stats-legend">
        {devices.map((d) => (
          <span key={d.device}>
            <i style={{ background: `var(${DEVICE_COLOR[d.device]})` }} />
            {d.device} · {d.arrived} visits
          </span>
        ))}
      </div>
      {STAGES.map((s) => (
        <div key={s.key} className="stats-funnel-row">
          <div className="stats-funnel-label">{s.label}</div>
          <div className="stats-funnel-bars">
            {devices.map((d) => {
              const n = Number(d[s.key]);
              const share = d.arrived ? n / d.arrived : 0;
              return (
                <div key={d.device} className="stats-funnel-bar" title={`${d.device}: ${n} of ${d.arrived}`}>
                  <span
                    className="stats-bar-fill"
                    style={{ width: `${Math.max(share * 100, n ? 1 : 0)}%`, background: `var(${DEVICE_COLOR[d.device]})` }}
                  />
                  <span className="stats-funnel-value">{pct(n, d.arrived)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
