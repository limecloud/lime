type CopyConversationListener = () => void;

const listeners = new Set<CopyConversationListener>();

export function requestCopyConversation(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCopyConversation(
  listener: CopyConversationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
