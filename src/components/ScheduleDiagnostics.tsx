import React, { useEffect, useState } from 'react';
import { getScheduleDebugToday } from '../api/debug';
import { CONFIG } from '../config';

export default function ScheduleDiagnostics() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  async function load() {
    if (!CONFIG.API_BASE_URL) return;
    setLoading(true);
    try {
      const res = await getScheduleDebugToday(CONFIG.CHANNEL, CONFIG.WEEK);
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const total = data?.scheduleItems?.length || 0;
  const found = data?.assetsFound?.length || 0;
  const missing = data?.assetsMissing?.length || 0;

  return (
    <div className="schedule-diag">
      <h3>Schedule Diagnostics</h3>
      <div style={{ fontSize: 12 }}>
        Today — Total: {total} · Found: {found} · Missing: {missing}
      </div>
      {missing > 0 && (
        <div style={{ fontSize: 11, marginTop: 4 }}>
          Missing asset IDs (first 5): {data.assetsMissing.slice(0,5).join(', ')}
        </div>
      )}
      <button className="win95-button" onClick={load} disabled={loading} style={{ marginTop: 6 }}>
        {loading ? 'Checking…' : 'Recheck'}
      </button>
      {error && <div style={{ color: '#d32f2f', fontSize: 11 }}>{error}</div>}
    </div>
  );
}

