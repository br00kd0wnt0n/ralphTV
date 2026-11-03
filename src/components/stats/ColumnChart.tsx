import { useEffect, useRef, useState } from 'react';
import { niceMax } from '../../state/statsFormat';

export interface ColumnSeries {
  name: string;
  /** CSS custom property holding the fill, e.g. '--viz-1'. */
  color: string;
}

export interface ColumnDatum {
  key: string;
  /** Axis label; empty string hides it (for dense axes). */
  label: string;
  /** One value per series, stacked bottom-up in series order. */
  values: number[];
  /** Tooltip lines. */
  tip: string[];
}

interface Props {
  data: ColumnDatum[];
  series: ColumnSeries[];
  height?: number;
  formatTick?: (v: number) => string;
  ariaLabel: string;
}

const PAD = { top: 12, right: 8, bottom: 22, left: 40 };
const GAP = 2; // surface gap between stacked segments and adjacent columns

/** Stacked column chart in inline SVG with a per-column hover tooltip. */
export default function ColumnChart({ data, series, height = 200, formatTick = String, ariaLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width so text and bars keep their pixel size.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.values.reduce((a, b) => a + b, 0))));
  const slot = data.length ? innerW / data.length : innerW;
  const barW = Math.max(2, Math.min(28, slot - GAP * 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 56)));

  return (
    <div className="stats-chart" ref={wrapRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stats-grid" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="stats-tick">{formatTick(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={d.key} opacity={hover === null || hover === i ? 1 : 0.45}>
              {d.values.map((v, si) => {
                if (v <= 0) return null;
                const top = y(acc + v);
                const bottom = y(acc) - (acc > 0 ? GAP : 0);
                acc += v;
                const isTop = d.values.slice(si + 1).every((n) => n <= 0);
                const h = Math.max(1, bottom - top);
                return (
                  <rect key={si} x={cx - barW / 2} y={top} width={barW} height={h}
                    rx={isTop ? Math.min(4, barW / 2, h) : 0}
                    style={{ fill: `var(${series[si]?.color ?? '--viz-1'})` }} />
                );
              })}
              {d.label && i % labelEvery === 0 && (
                <text x={cx} y={H - 6} textAnchor="middle" className="stats-tick">{d.label}</text>
              )}
              {/* Hit target: the whole column slot, taller than the mark. */}
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="stats-tooltip" style={{ left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%` }}>
          {data[hover].tip.map((line, i) => <div key={i} className={i === 0 ? 'stats-tooltip-title' : ''}>{line}</div>)}
        </div>
      )}
      {series.length > 1 && (
        <div className="stats-legend">
          {series.map((s) => (
            <span key={s.name}><i style={{ background: `var(${s.color})` }} />{s.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
