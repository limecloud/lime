import { afterEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "./safeInvoke";
import { resolveBridgeRequestTimeoutMs } from "./http-client";

afterEach(() => {
  delete window.electronAPI;
  vi.useRealTimers();
});

describe("system permission dialog transport lifetime", () => {
  it("keeps the real IPC wrapper waiting beyond the default timeout until the user finishes the system dialog", async () => {
    vi.useFakeTimers();
    let respond!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      respond = resolve;
    });
    window.electronAPI = {
      invoke: <T>() => response as Promise<T>,
      listen: () => () => undefined,
      emit: async () => undefined,
    };
    let settled = false;
    const result = safeInvoke("desktop_permissions_request", {
      id: "files",
    }).then(
      (value) => {
        settled = true;
        return value;
      },
      (error) => {
        settled = true;
        throw error;
      },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    respond({ canceled: true });
    expect(await result).toEqual({ canceled: true });
  });
  it("lets the OS own prompt lifetime while keeping reads and other commands bounded", () => {
    expect(resolveBridgeRequestTimeoutMs("desktop_permissions_request")).toBe(
      0,
    );
    expect(resolveBridgeRequestTimeoutMs("desktop_permissions_read")).toBe(
      30_000,
    );
    expect(resolveBridgeRequestTimeoutMs("workspace_list")).toBe(5_000);
  });
});
