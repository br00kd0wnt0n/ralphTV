import React, { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import { streamerStatus } from '../api/streamer';
import { getRelayStatus, checkRelayHealth } from '../api/relay';
import '../styles/system-status.css';

interface ServiceStatus {
  name: string;
  status: 'online' | 'offline' | 'error' | 'unknown';
  message?: string;
  lastCheck?: Date;
}

export default function SystemStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'API Server', status: 'unknown' },
    { name: 'Streamer', status: 'unknown' },
    { name: 'Relay Service', status: 'unknown' },
    { name: 'YouTube Ingest', status: 'unknown' },
    { name: 'Web Player', status: 'unknown' },
  ]);

  useEffect(() => {
    const checkServices = async () => {
      const newStatuses: ServiceStatus[] = [];

      // Check API Server
      if (CONFIG.API_BASE_URL) {
        try {
          const response = await fetch(`${CONFIG.API_BASE_URL}/health`).catch(() => null);
          newStatuses.push({
            name: 'API Server',
            status: response?.ok ? 'online' : 'offline',
            message: response?.ok ? CONFIG.API_BASE_URL : 'Unreachable',
            lastCheck: new Date()
          });
        } catch {
          newStatuses.push({
            name: 'API Server',
            status: 'offline',
            message: 'Connection failed',
            lastCheck: new Date()
          });
        }
      } else {
        newStatuses.push({
          name: 'API Server',
          status: 'offline',
          message: 'Not configured',
          lastCheck: new Date()
        });
      }

      // Check Streamer
      try {
        const status = await streamerStatus();
        newStatuses.push({
          name: 'Streamer',
          status: status.running ? 'online' : 'offline',
          message: status.running ? 'Running' : 'Stopped',
          lastCheck: new Date()
        });
      } catch {
        newStatuses.push({
          name: 'Streamer',
          status: 'error',
          message: 'Error fetching status',
          lastCheck: new Date()
        });
      }

      // Check Relay
      if (CONFIG.RELAY_BASE_URL) {
        try {
          const health = await checkRelayHealth();
          const status = await getRelayStatus().catch(() => null);
          newStatuses.push({
            name: 'Relay Service',
            status: health.available ? 'online' : 'offline',
            message: status?.streaming ? 'Streaming' : 'Ready',
            lastCheck: new Date()
          });
        } catch {
          newStatuses.push({
            name: 'Relay Service',
            status: 'offline',
            message: 'Unavailable',
            lastCheck: new Date()
          });
        }
      } else {
        newStatuses.push({
          name: 'Relay Service',
          status: 'offline',
          message: 'Not configured',
          lastCheck: new Date()
        });
      }

      // Check YouTube (based on relay destinations)
      try {
        if (CONFIG.RELAY_BASE_URL) {
          const destResponse = await fetch(`${CONFIG.RELAY_BASE_URL}/api/destinations`).catch(() => null);
          const destData = await destResponse?.json().catch(() => null);
          const hasYouTube = destData?.destinations?.some((d: string) => d.toLowerCase().includes('youtube'));
          newStatuses.push({
            name: 'YouTube Ingest',
            status: hasYouTube ? 'online' : 'offline',
            message: hasYouTube ? 'Configured' : 'Not configured',
            lastCheck: new Date()
          });
        } else {
          newStatuses.push({
            name: 'YouTube Ingest',
            status: 'offline',
            message: 'Relay not configured',
            lastCheck: new Date()
          });
        }
      } catch {
        newStatuses.push({
          name: 'YouTube Ingest',
          status: 'unknown',
          message: 'Unable to check',
          lastCheck: new Date()
        });
      }

      // Check Web Player (HLS stream availability)
      if (CONFIG.RELAY_BASE_URL) {
        try {
          const streamUrl = `${CONFIG.RELAY_BASE_URL}/hls/stream.m3u8`;
          const response = await fetch(streamUrl, { method: 'HEAD' }).catch(() => null);
          newStatuses.push({
            name: 'Web Player',
            status: response?.ok ? 'online' : 'offline',
            message: response?.ok ? 'Stream available' : 'No stream',
            lastCheck: new Date()
          });
        } catch {
          newStatuses.push({
            name: 'Web Player',
            status: 'offline',
            message: 'Stream unavailable',
            lastCheck: new Date()
          });
        }
      } else {
        newStatuses.push({
          name: 'Web Player',
          status: 'offline',
          message: 'Relay not configured',
          lastCheck: new Date()
        });
      }

      setServices(newStatuses);
    };

    checkServices();
    const interval = setInterval(checkServices, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return '●';
      case 'offline':
        return '○';
      case 'error':
        return '⚠';
      default:
        return '?';
    }
  };

  const overallHealth = services.every(s => s.status === 'online' || s.status === 'offline')
    ? services.filter(s => s.status === 'online').length
    : 0;

  return (
    <div className="system-status-container">
      <div className="system-status-header">
        <h4>System Status</h4>
      </div>
      <div className="system-status-content">
        <div className="system-health-summary">
          <span className="health-label">Services Online:</span>
          <span className="health-value">{overallHealth} / {services.length}</span>
        </div>
        <div className="service-list">
          {services.map((service, idx) => (
            <div key={idx} className="service-item">
              <div className="service-status">
                <span className={`status-indicator status-${service.status}`}>
                  {getStatusIcon(service.status)}
                </span>
                <span className="service-name">{service.name}</span>
              </div>
              {service.message && (
                <div className="service-message">{service.message}</div>
              )}
            </div>
          ))}
        </div>
        {services.length > 0 && services[0].lastCheck && (
          <div className="last-check">
            Last updated: {services[0].lastCheck.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
