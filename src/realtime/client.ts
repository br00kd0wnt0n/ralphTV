import { CONFIG } from '../config';

type Handler = (event: any) => void;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<Handler>> = new Map();
  private retryCount = 0;
  private maxRetries = 10;

  connect() {
    if (!CONFIG.REALTIME_URL) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      this.ws = new WebSocket(CONFIG.REALTIME_URL);
      this.ws.onopen = () => {
        this.retryCount = 0; // Reset on successful connection
        for (const topic of this.handlers.keys()) this.send({ type: 'subscribe', topic });
      };
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as any);
          const topic = data.topic || data.t;
          if (!topic) return;
          const set = this.handlers.get(topic);
          if (!set) return;
          set.forEach((h) => h(data));
        } catch {}
      };
      this.ws.onclose = () => {
        if (this.retryCount >= this.maxRetries) return;
        const delay = Math.min(1500 * Math.pow(2, this.retryCount), 30000);
        this.retryCount++;
        setTimeout(() => this.connect(), delay);
      };
    } catch {}
  }

  disconnect() {
    if (this.ws) try { this.ws.close(); } catch {} finally { this.ws = null; }
    this.handlers.clear();
  }

  subscribe(topic: string, handler: Handler) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();
    this.send({ type: 'subscribe', topic });
    return () => this.unsubscribe(topic, handler);
  }

  unsubscribe(topic: string, handler: Handler) {
    const set = this.handlers.get(topic);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(topic);
      this.send({ type: 'unsubscribe', topic });
    }
  }

  private send(payload: any) {
    const data = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(data); } catch {}
    }
  }
}

export function buildScheduleTopic(channel: string, week: string, day: string) {
  return `schedule:${channel}:${week}:${day}`;
}

