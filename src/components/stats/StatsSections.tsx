import type { ReactNode } from 'react';
import type { Overview, ShowRow } from '../../api/stats';
import { compact, duration, eachDay, pct, shortDay, watchTotal } from '../../state/statsFormat';
import KpiRow from './KpiRow';
import ColumnChart, { type ColumnDatum } from './ColumnChart';
import FunnelChart from './FunnelChart';
import ShowsTable from './ShowsTable';
import { ActionsTable, DevicesTable, SourcesTable } from './Breakdowns';

function Section({ title, sub, children, wide }: { title: string; sub?: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'stats-card stats-wide' : 'stats-card'}>
      <h2>{title}</h2>
      {sub && <p className="stats-sub">{sub}</p>}
      {children}
    </section>
  );
}

function dailyData(o: Overview): ColumnDatum[] {
  const byDay = new Map(o.daily.map((d) => [d.day, d]));
  return eachDay(o.from, o.to).map((day) => {
    const d = byDay.get(day) ?? { day, visits: 0, viewers: 0, watch_sec: 0 };
    return {
      key: day,
      label: shortDay(day),
      values: [d.viewers, d.visits - d.viewers],
      tip: [shortDay(day), `${d.visits} visits`, `${d.viewers} watched 10s+ (${pct(d.viewers, d.visits)})`, `${watchTotal(d.watch_sec)} watched`],
    };
  });
}

function hourData(o: Overview): ColumnDatum[] {
  const byHour = new Map(o.hours.map((h) => [h.hour, h]));
  return Array.from({ length: 24 }, (_, h) => {
    const r = byHour.get(h);
    const mins = Math.round((r?.watch_sec ?? 0) / 60);
    const label = `${String(h).padStart(2, '0')}:00`;
    return {
      key: String(h),
      label: h % 3 === 0 ? label : '',
      values: [mins],
      tip: [`${label}–${String(h).padStart(2, '0')}:59`, `${duration(r?.watch_sec ?? 0)} watched`, `${r?.viewers ?? 0} viewers`],
    };
  });
}

/** Everything below the filters. Order follows the questions from the Matt call:
 *  are people watching, where do they drop, what do they watch, where from, on what. */
export default function StatsSections({ overview: o, shows }: { overview: Overview; shows: ShowRow[] }) {
  const single = o.from === o.to;
  return (
    <div className="stats-grid-layout">
      <div className="stats-wide"><KpiRow k={o.kpis} /></div>

      <Section title="Where visits drop off" sub="Share of each device's visits that reached each stage." wide>
        <FunnelChart rows={o.funnel} />
      </Section>

      {!single && (
        <Section title="Visits per day" sub="Split into viewers (watched 10s+) and bounces." wide>
          <ColumnChart
            ariaLabel="Visits per day, viewers and bounces"
            data={dailyData(o)}
            series={[{ name: 'Watched 10s+', color: '--viz-1' }, { name: 'Bounced', color: '--viz-muted' }]}
            formatTick={compact}
          />
        </Section>
      )}

      <Section title="Shows" sub="Clip on screen while people watched. “Typical exit” is the median point viewers who left during the clip closed the tab." wide>
        <ShowsTable shows={shows} />
      </Section>

      <Section title="When people watch" sub="Minutes watched by hour of day (London).">
        <ColumnChart ariaLabel="Minutes watched by hour of day" data={hourData(o)}
          series={[{ name: 'Minutes watched', color: '--viz-1' }]} formatTick={compact} height={180} />
      </Section>

      <Section title="Where they came from" sub="UTM source if the link had one, else the referring site. Email and chat apps often show as direct.">
        <SourcesTable rows={o.sources} />
      </Section>

      <Section title="What people do in the player">
        <ActionsTable rows={o.actions} visits={o.kpis.visits} />
      </Section>

      <Section title="Devices">
        <DevicesTable rows={o.devices} />
      </Section>
    </div>
  );
}
