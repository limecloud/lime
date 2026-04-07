type TauriInternals = {
  invoke?: unknown;
  transformCallback?: unknown;
};

function getWindowObject(): (Window & typeof globalThis) | null {
  return typeof window === "undefined" ? null : window;
}

export function getTauriGlobal(): Record<string, unknown> | null {
  const currentWindow = getWindowObject() as
    | ((Window & typeof globalThis) & { __TAURI__?: Record<string, unknown> })
    | null;
  return currentWindow?.__TAURI__ ?? null;
}

function getTauriInternals(): TauriInternals | null {
  const currentWindow = getWindowObject() as
    | ((Window & typeof globalThis) & {
        __TAURI_INTERNALS__?: TauriInternals;
      })
    | null;
  return currentWindow?.__TAURI_INTERNALS__ ?? null;
}

export function hasTauriRuntimeMarkers(): boolean {
  const currentWindow = getWindowObject();
  if (!currentWindow) {
    return false;
  }

  return Boolean(getTauriGlobal()) || "__TAURI_INTERNALS__" in currentWindow;
}

export function hasTauriInvokeCapability(): boolean {
  const tauriGlobal = getTauriGlobal() as {
    core?: { invoke?: unknown };
    invoke?: unknown;
  } | null;
  const internals = getTauriInternals();

  return (
    typeof tauriGlobal?.core?.invoke === "function" ||
    typeof tauriGlobal?.invoke === "function" ||
    typeof internals?.invoke === "function"
  );
}

export function hasTauriEventCapability(): boolean {
  const tauriGlobal = getTauriGlobal() as {
    event?: {
      listen?: unknown;
      emit?: unknown;
    };
  } | null;
  const internals = getTauriInternals();

  return (
    typeof tauriGlobal?.event?.listen === "function" ||
    (typeof internals?.invoke === "function" &&
      typeof internals?.transformCallback === "function")
  );
}

export function hasTauriEventListenerCapability(): boolean {
  const internals = getTauriInternals();

  return (
    typeof internals?.invoke === "function" &&
    typeof internals?.transformCallback === "function"
  );
}
