import React, { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import { getRelayStatus, checkRelayHealth } from '../api/relay';
import '../styles/status-badge.css';

export default function StatusBadge() {
  const [relayOnline, setRelayOnline] = useState(true);
  const [apiOnline, setApiOnline] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());

  useEffect(() => {
    const checkStatus = async () => {
      // Check API
      if (CONFIG.API_BASE_URL) {
        try {
          const response = await fetch(`${CONFIG.API_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
          setApiOnline(response.ok);
        } catch {
          setApiOnline(false);
        }
      }

      // Check Relay
      if (CONFIG.RELAY_BASE_URL) {
        try {
          const health = await checkRelayHealth();
          setRelayOnline(health.available);
        } catch {
          setRelayOnline(false);
        }
      }

      setLastCheck(new Date());
    };

    checkStatus();
    const interval = setInterval(checkStatus, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, []);

  // Only show badge if there's an outage
  if (relayOnline && apiOnline) return null;

  return (
    <div className="status-badge-overlay">
      <div className="status-badge-content">
        {!apiOnline && (
          <div className="badge-item error">
            <span className="badge-icon">!</span>
            <span className="badge-label">API Offline</span>
          </div>
        )}
        {!relayOnline && (
          <div className="badge-item warning">
            <span className="badge-icon">!</span>
            <span className="badge-label">Relay Offline</span>
          </div>
        )}
        <div className="badge-timestamp">
          Last check: {lastCheck.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
