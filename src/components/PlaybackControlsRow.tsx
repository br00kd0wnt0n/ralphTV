import React from 'react';
import type { Day } from '../state/models';
import { DAYS } from '../state/models';

export default function PlaybackControlsRow({
  values,
  onChange,
}: {
  values: Record<Day, { mode: 'loop'|'playthru'; start?: string }>;
  onChange: (day: Day, mode: 'loop'|'playthru', start?: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
      {DAYS.map((day) => (
        <div key={day} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: '6px 8px', minWidth: 180 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>{day} playback</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={values[day]?.mode || 'loop'} onChange={(e) => onChange(day, e.target.value as any, values[day]?.start)} style={{ fontSize: 12 }}>
              <option value="loop">Looping</option>
              <option value="playthru">Play-through</option>
            </select>
            {values[day]?.mode === 'playthru' && (
              <>
                <label style={{ fontSize: 12 }}>Start</label>
                <input type="time" value={values[day]?.start || ''} onChange={(e) => onChange(day, 'playthru', e.target.value)} style={{ fontSize: 12 }} />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

