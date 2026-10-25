interface QuitEvent {
  preventDefault(): void;
}

interface QuitApp {
  on(
    event: "before-quit" | "will-quit",
    listener: (event: QuitEvent) => void,
  ): unknown;
  quit(): void;
}

interface QuitLifecycle {
  prepare(): void;
  dispose(): Promise<void>;
  onError(error: unknown): void;
}

/** Keep Main alive until its existing asynchronous owners have stopped. */
export function installAppQuitLifecycle(
  app: QuitApp,
  { prepare, dispose, onError }: QuitLifecycle,
): void {
  let prepared = false;
  let drained = false;
  let shutdown: Promise<void> | undefined;

  app.on("before-quit", (event) => {
    if (drained) return;
    event.preventDefault();
    if (!prepared) {
      prepared = true;
      prepare();
    }
    shutdown ??= Promise.resolve()
      .then(dispose)
      .catch(onError)
      .finally(() => {
        drained = true;
        // Drain while windows and Electron's event loop still exist, then
        // resume the normal quit on the next turn without re-entering dispatch.
        setTimeout(() => app.quit(), 0);
      });
  });
}
