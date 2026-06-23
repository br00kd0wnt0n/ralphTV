import React, { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import '../styles/system-status.css';

interface ServiceStatus {
  name: string;
  status: 'online' | 'offline' | 'error' | 'unknown';
  message: string;
}

interface SystemStatusResponse {
  timestamp: string;
  services: ServiceStatus[];
}

export default function SystemStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkServices = async () => {
      if (!CONFIG.API_BASE_URL) {
        setServices([{
          name: 'Backend API',
          status: 'offline',
          message: 'Not configured'
        }]);
        setLoading(false);
        return;
      }

      if (typeof document !== 'undefined' && document.hidden) return; // skip while tab is backgrounded
      try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/system/status`);
        if (response.ok) {
          const data: SystemStatusResponse = await response.json();
          setServices(data.services);
          setLastCheck(new Date(data.timestamp));
        } else {
          // Backend is reachable but returned error
          setServices([{
            name: 'Backend API',
            status: 'error',
            message: `HTTP ${response.status}`
          }]);
        }
      } catch (error) {
        // Backend is unreachable
        setServices([{
          name: 'Backend API',
          status: 'offline',
          message: 'Unreachable'
        }]);
      }
      setLoading(false);
    };

    checkServices();
    const interval = setInterval(checkServices, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return '●'; // Green dot - fully operational
      case 'offline':
        return '○'; // Gray circle - not available
      case 'error':
        return '●'; // Orange dot - error state
      case 'unknown':
        return '○'; // Gray circle - unknown
      default:
        return '?';
    }
  };

  const onlineCount = services.filter(s => s.status === 'online').length;
  const totalCount = services.length;

  return (
    <div className="system-status-container">
      <div className="system-status-header">
        <h4>System Status</h4>
      </div>
      <div className="system-status-content">
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Checking services...
          </div>
        ) : (
          <>
            <div className="system-health-summary">
              <span className="health-label">Services Online:</span>
              <span className="health-value">{onlineCount} / {totalCount}</span>
            </div>
            <div className="service-list">
              {services.map((service, idx) => (
                <div key={idx} className={`service-item service-${service.status}`}>
                  <div className="service-status">
                    <span
                      className={`status-indicator status-${service.status}`}
                      title={`${service.name}: ${service.status}`}
                    >
                      {getStatusIcon(service.status)}
                    </span>
                    <span className="service-name">{service.name}</span>
                    <span className={`status-label status-label-${service.status}`}>
                      {service.message}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {lastCheck && (
              <div className="last-check">
                Last updated: {lastCheck.toLocaleTimeString()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
