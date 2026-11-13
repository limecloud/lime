type Listener = () => void;

const listeners = new Set<Listener>();

export function requestWorkspaceReviewTab(): void {
  for (const listener of listeners) listener();
}

export function subscribeWorkspaceReviewTabRequest(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
