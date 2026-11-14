type WorkspaceReviewTabListener = (action: WorkspaceReviewTabAction) => void;

export type WorkspaceReviewTabAction = "open" | "toggle" | "close";

const listeners = new Set<WorkspaceReviewTabListener>();

function request(action: WorkspaceReviewTabAction): void {
  for (const listener of listeners) listener(action);
}

export function requestWorkspaceReviewTab(): void {
  request("open");
}

export function requestWorkspaceReviewTabToggle(): void {
  request("toggle");
}

export function requestWorkspaceReviewTabClose(): void {
  request("close");
}

export function subscribeWorkspaceReviewTabRequest(
  listener: WorkspaceReviewTabListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
