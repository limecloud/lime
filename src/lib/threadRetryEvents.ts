export interface RetryThreadAtTurnRequest {
  threadId: string;
  turnId: string;
}

type RetryThreadAtTurnListener = (
  request: RetryThreadAtTurnRequest,
) => void | Promise<void>;

const listeners = new Set<RetryThreadAtTurnListener>();

export function requestRetryThreadAtTurn(
  request: RetryThreadAtTurnRequest,
): void {
  if (!request.threadId.trim() || !request.turnId.trim()) return;
  for (const listener of listeners) {
    void listener(request);
  }
}

export function subscribeRetryThreadAtTurn(
  listener: RetryThreadAtTurnListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
