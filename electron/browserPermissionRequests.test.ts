import { describe, expect, it, vi } from "vitest";
import type { Session } from "electron";
import { BrowserPermissionRequests } from "./browserPermissionRequests";

describe("shared Session browser navigation permission owner", () => {
  it("multiplexes one listener and cancels ungranted main frames while leaving subresources untouched", () => {
    const onBeforeRequest = vi.fn();
    const session = { webRequest: { onBeforeRequest } } as unknown as Session;
    const blocked = vi.fn();
    const owners = [31, 32].map((id) => new BrowserPermissionRequests({
      viewId: webContentsId => webContentsId === id ? `view-${id}` : null,
      allows: (_, url) => new URL(url).origin === "https://allowed.example", blocked,
    }));
    for (const owner of owners) owner.install(session);
    owners[0].install(session);
    expect(onBeforeRequest).toHaveBeenCalledTimes(1);
    const listener = onBeforeRequest.mock.calls[0][1];
    const callback = vi.fn();
    listener({ resourceType: "mainFrame", webContentsId: 31, url: "https://blocked.example/path" }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    expect(blocked).toHaveBeenCalledWith("view-31", "https://blocked.example/path", expect.stringContaining("retry goto"));
    expect(owners[0].takeFailure("view-31")).toContain("https://blocked.example");
    expect(owners[0].takeFailure("view-31")).toBeNull();
    callback.mockClear();
    listener({ resourceType: "mainFrame", webContentsId: 32, url: "https://allowed.example/" }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false });
    for (const resourceType of ["script", "image", "stylesheet", "subFrame"]) {
      callback.mockClear();
      listener({ resourceType, webContentsId: 31, url: "https://cdn.example/asset" }, callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false });
    }
    owners[0].dispose();
    expect(onBeforeRequest).toHaveBeenCalledTimes(1);
    owners[1].dispose();
    expect(onBeforeRequest).toHaveBeenLastCalledWith(null);
  });

  it("fails owned navigations closed when its policy resolver fails", () => {
    const owner = new BrowserPermissionRequests({ viewId: id => id === 31 ? "view-31" : null,
      allows: () => { throw new Error("policy unavailable"); }, blocked: () => undefined });
    expect(owner.decide({ resourceType: "mainFrame", webContentsId: 31, url: "https://target.example/" })).toBe(false);
    expect(owner.decide({ resourceType: "mainFrame", webContentsId: 99, url: "https://target.example/" })).toBeNull();
  });
});
