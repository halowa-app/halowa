import { getApiUrl, type Envelope, type Session } from './lib';

type Callbacks = {
  snapshot: (items: Envelope[]) => void;
  location: (item: Envelope) => void;
  revoke: (senderId: string) => void;
};

export function subscribeToLocations(session: Session, callbacks: Callbacks) {
  let active = true;
  let retryMs = 1000;
  let retryTimer: number | undefined;
  const controller = new AbortController();

  const connect = async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/location/stream`, {
        headers: { Authorization: `Bearer ${session.token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('Flux de positions indisponible.');
      retryMs = 1000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (active) {
        const { value, done } = await reader.read();
        if (!active || done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!event || !data) continue;
          try {
            const parsed = JSON.parse(data);
            if (event === 'snapshot' && Array.isArray(parsed)) callbacks.snapshot(parsed);
            else if (event === 'location') callbacks.location(parsed);
            else if (event === 'revoke' && typeof parsed?.from === 'string') callbacks.revoke(parsed.from);
          } catch { /* Ignore a malformed frame and continue receiving. */ }
        }
        if (buffer.length > 100_000) buffer = '';
      }
    } catch { /* Reconnect after a network interruption. */ }
    if (active) {
      retryTimer = window.setTimeout(() => { void connect(); }, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  };

  void connect();
  return () => {
    active = false;
    controller.abort();
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  };
}
