type ScheduleTaskListener = (threadId: string) => void;

const listeners = new Set<ScheduleTaskListener>();

export function requestScheduledTaskForThread(threadId: string): void {
  const normalized = threadId.trim();
  if (!normalized) return;
  for (const listener of listeners) {
    listener(normalized);
  }
}

export function subscribeScheduledTaskRequest(
  listener: ScheduleTaskListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
