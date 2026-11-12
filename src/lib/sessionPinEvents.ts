type SessionPinToggleListener = (sessionId: string) => void;

const listeners = new Set<SessionPinToggleListener>();

export function requestSessionPinToggle(sessionId: string): void {
  const normalized = sessionId.trim();
  if (!normalized) return;
  for (const listener of listeners) {
    listener(normalized);
  }
}

export function subscribeSessionPinToggle(
  listener: SessionPinToggleListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
