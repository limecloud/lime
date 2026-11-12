type OpenChangesSurfaceListener = () => void;

const listeners = new Set<OpenChangesSurfaceListener>();

export function requestOpenChangesSurface(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeOpenChangesSurface(
  listener: OpenChangesSurfaceListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
