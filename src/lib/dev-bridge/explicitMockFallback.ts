import type { UnlistenFn } from "@tauri-apps/api/event";

let mockCoreModulePromise:
  | Promise<typeof import("../tauri-mock/core")>
  | null = null;
let mockEventModulePromise:
  | Promise<typeof import("../tauri-mock/event")>
  | null = null;

function loadMockCoreModule() {
  mockCoreModulePromise ??= import("../tauri-mock/core");
  return mockCoreModulePromise;
}

function loadMockEventModule() {
  mockEventModulePromise ??= import("../tauri-mock/event");
  return mockEventModulePromise;
}

export async function invokeExplicitMock<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await loadMockCoreModule();
  return invoke<T>(cmd, args);
}

export async function listenExplicitMock<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  const { listen } = await loadMockEventModule();
  return listen<T>(event, (payload) => {
    handler({ payload });
  });
}
