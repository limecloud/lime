export interface ForkThreadAtTurnRequest {
  threadId: string;
  turnId: string;
}

type ForkThreadAtTurnListener = (
  request: ForkThreadAtTurnRequest,
) => void | Promise<void>;

const listeners = new Set<ForkThreadAtTurnListener>();

export function requestForkThreadAtTurn(
  request: ForkThreadAtTurnRequest,
): void {
  if (!request.threadId.trim() || !request.turnId.trim()) return;
  for (const listener of listeners) {
    void listener(request);
  }
}

export function subscribeForkThreadAtTurn(
  listener: ForkThreadAtTurnListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
