// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import os from "node:os";
import { DesktopPermissionsHost } from "./desktopPermissionsHost";
import {
  parseDesktopPermissions,
  type DesktopPermissionState,
} from "../src/lib/api/desktopPermissionsTypes";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(platform = "darwin") {
  const root = await mkdtemp(path.join(os.tmpdir(), "permissions-"));
  roots.push(root);
  const nativeInvoke = vi.fn(
    async (
      method: string,
      _params?: Record<string, unknown>,
    ): Promise<unknown> => {
      if (method === "capabilities.read")
        return {
          applicationId: "native.test",
          accessibility: { status: "not_granted" },
          screenCapture: { status: "ready" },
          inputMonitoring: { status: "not_granted" },
          appleEvents: { status: "ready" },
        };
      if (method === "appleEvents.targets")
        return {
          targets: [
            {
              bundleId: "app.test",
              name: "Test",
              terminated: false,
              userFacing: true,
            },
            { bundleId: "app.test", name: "Test", userFacing: true },
            {
              bundleId: "background.helper",
              name: "Helper",
              userFacing: false,
            },
          ],
        };
      if (method === "appleEvents.read") return { status: "not_granted" };
      return { status: "ready" };
    },
  );
  const options = {
    platform,
    appDataRoot: root,
    applicationPath: "/Applications/Lime.app/Contents/MacOS/Lime",
    packaged: true,
    homeDirectory: root,
    nativeInvoke,
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((text: string) => Buffer.from(text)),
      decryptString: vi.fn((data: Buffer) => data.toString()),
      getSelectedStorageBackend: vi.fn(() => "keychain"),
    },
    mediaStatus: vi.fn((_kind: "microphone" | "camera") => "not-determined"),
    requestMedia: vi.fn(async (_kind: "microphone" | "camera") => false),
    diskAccess: vi.fn(async (): Promise<DesktopPermissionState> => "unknown"),
    nativePermission: vi.fn(
      async (_id: "notifications" | "location", _request?: boolean) =>
        "unknown" as DesktopPermissionState,
    ),
    notificationsSupported: () => true,
    openExternal: vi.fn(async (_url: string) => undefined),
    revealApplication: vi.fn(),
    chooseDirectory: vi.fn(async (): Promise<string | null> => null),
  };
  const host = new DesktopPermissionsHost(options);
  const read = async (args?: Record<string, unknown>) =>
    parseDesktopPermissions(
      await host.invoke("desktop_permissions_read", args),
    );
  return {
    host,
    read,
    options,
    root,
    state: async (id: string) =>
      (await read()).permissions.find((item) => item.id === id)!.state,
  };
}
describe("Desktop OS permission setup", () => {
  it("reads native state without prompting, accessing keychain, or treating capability availability as automation consent", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    expect(snapshot.setupComplete).toBe(false);
    expect(snapshot.nativeApplicationId).toBe("native.test");
    expect(snapshot.permissions.map(({ id, state }) => [id, state])).toEqual([
      ["installation", "granted"],
      ["secureStorage", "unknown"],
      ["accessibility", "denied"],
      ["screenCapture", "granted"],
      ["inputMonitoring", "denied"],
      ["automation", "unknown"],
      ["microphone", "notDetermined"],
      ["camera", "notDetermined"],
      ["notifications", "unknown"],
      ["files", "unknown"],
      ["fullDiskAccess", "unknown"],
      ["localNetwork", "onDemand"],
      ["location", "unknown"],
    ]);
    expect(f.options.nativeInvoke.mock.calls).toEqual([["capabilities.read"]]);
    expect(f.options.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(f.options.requestMedia).not.toHaveBeenCalled();
    expect(f.options.openExternal).not.toHaveBeenCalled();
  });
  it("verifies secure storage only after the explicit request, without persisting probe content", async () => {
    const f = await fixture();
    await f.host.invoke("desktop_permissions_request", { id: "secureStorage" });
    expect(await f.state("secureStorage")).toBe("granted");
    expect(f.options.safeStorage.encryptString).toHaveBeenCalledWith(
      "desktop-permissions-check",
    );
    await expect(
      readFile(path.join(f.root, "permissions", "setup.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    f.options.safeStorage.getSelectedStorageBackend.mockReturnValue(
      "basic_text",
    );
    await f.host.invoke("desktop_permissions_request", { id: "secureStorage" });
    expect(await f.state("secureStorage")).toBe("unavailable");
    f.options.safeStorage.getSelectedStorageBackend.mockReturnValue("keychain");
    f.options.safeStorage.decryptString.mockImplementationOnce(() => {
      throw new Error("Keychain access canceled");
    });
    await f.host.invoke("desktop_permissions_request", { id: "secureStorage" });
    expect(await f.state("secureStorage")).toBe("denied");
  });
  it("keeps rejection and restriction truthful and opens settings for a previously denied microphone", async () => {
    const f = await fixture();
    await f.host.invoke("desktop_permissions_request", { id: "microphone" });
    expect(f.options.requestMedia).toHaveBeenCalledWith("microphone");
    expect(await f.state("microphone")).toBe("notDetermined");
    f.options.mediaStatus.mockReturnValue("denied");
    await f.host.invoke("desktop_permissions_request", { id: "microphone" });
    expect(f.options.requestMedia).toHaveBeenCalledTimes(1);
    expect(f.options.openExternal).toHaveBeenCalledWith(
      expect.stringContaining("Privacy_Microphone"),
    );
    expect(await f.state("microphone")).toBe("denied");
    f.options.mediaStatus.mockReturnValue("restricted");
    expect(
      (await f.read()).permissions.find((item) => item.id === "camera"),
    ).toMatchObject({ state: "restricted", canRequest: false });
  });
  it("requires a specific running automation target and never sends an Agent grant", async () => {
    const f = await fixture();
    await expect(
      f.host.invoke("desktop_permissions_request", { id: "automation" }),
    ).rejects.toThrow("Select");
    await expect(
      f.host.invoke("desktop_permissions_request", {
        id: "automation",
        targetBundleId: "not.running",
      }),
    ).rejects.toThrow("not running");
    await f.host.invoke("desktop_permissions_request", {
      id: "automation",
      targetBundleId: "app.test",
    });
    expect(f.options.nativeInvoke).toHaveBeenCalledWith("appleEvents.request", {
      targetBundleId: "app.test",
    });
    expect(
      (await f.read({ targetBundleId: "app.test" })).permissions.find(
        (item) => item.id === "automation",
      )?.state,
    ).toBe("denied");
    expect(await f.host.invoke("desktop_permissions_targets")).toEqual([
      { bundleId: "app.test", name: "Test" },
    ]);
  });
  it("rejects malformed or unrecognized requests before invoking the OS", async () => {
    const f = await fixture();
    for (const args of [
      { id: "anything" },
      { id: "camera", allow: true },
      { id: "automation", targetBundleId: "invalid/target" },
    ])
      await expect(
        f.host.invoke("desktop_permissions_request", args),
      ).rejects.toThrow();
    await expect(
      f.host.invoke("desktop_permissions_open_settings", {
        id: "camera",
        url: "https://example.com",
      }),
    ).rejects.toThrow();
    expect(f.options.nativeInvoke).not.toHaveBeenCalled();
    expect(f.options.openExternal).not.toHaveBeenCalled();
  });
  it("rejects concurrent requests while an OS prompt remains pending", async () => {
    const f = await fixture();
    let done!: (value: boolean) => void;
    f.options.requestMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const pending = f.host.invoke("desktop_permissions_request", {
      id: "microphone",
    });
    await expect(
      f.host.invoke("desktop_permissions_request", { id: "camera" }),
    ).rejects.toThrow("pending");
    done(false);
    await pending;
  });
  it("keeps setup completion separate from permission state across a fresh host", async () => {
    const f = await fixture();
    await f.host.invoke("desktop_permissions_complete");
    const next = new DesktopPermissionsHost(f.options);
    const state = parseDesktopPermissions(
      await next.invoke("desktop_permissions_read"),
    );
    expect(state.setupComplete).toBe(true);
    expect(
      state.permissions.find((item) => item.id === "secureStorage")?.state,
    ).toBe("unknown");
    expect(
      JSON.parse(
        await readFile(path.join(f.root, "permissions", "setup.json"), "utf8"),
      ),
    ).toEqual({ version: 1, complete: true });
  });
  it("checks only the chosen folder and keeps cancellation unapproved", async () => {
    const f = await fixture();
    await f.host.invoke("desktop_permissions_request", { id: "files" });
    expect(await f.state("files")).toBe("unknown");
    f.options.chooseDirectory.mockResolvedValue(f.root);
    await f.host.invoke("desktop_permissions_request", { id: "files" });
    expect(await f.state("files")).toBe("granted");
    expect((await f.read()).selectedDirectory).toBe(f.root);
    expect(await f.state("fullDiskAccess")).toBe("unknown");
    f.options.chooseDirectory.mockResolvedValue(path.join(f.root, "missing"));
    await expect(
      f.host.invoke("desktop_permissions_request", { id: "files" }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await f.read()).selectedDirectory).toBe(f.root);
    expect(await f.state("files")).toBe("granted");
    const next = new DesktopPermissionsHost(f.options);
    const restored = parseDesktopPermissions(
      await next.invoke("desktop_permissions_read"),
    );
    expect(restored.selectedDirectory).toBe(f.root);
    expect(
      restored.permissions.find((item) => item.id === "files")?.state,
    ).toBe("granted");
  });
  it("uses the process that consumes notifications and location, requests consent, and rereads the OS state", async () => {
    const f = await fixture();
    let notificationState: "notDetermined" | "granted" = "notDetermined";
    f.options.nativePermission.mockImplementation(async (id, request) => {
      if (id === "notifications" && request) notificationState = "granted";
      return id === "notifications" ? notificationState : "denied";
    });
    const result = parseDesktopPermissions(
      await f.host.invoke("desktop_permissions_request", {
        id: "notifications",
      }),
    );
    expect(f.options.nativePermission).toHaveBeenCalledWith(
      "notifications",
      true,
    );
    expect(
      result.permissions.find((item) => item.id === "notifications")?.state,
    ).toBe("granted");
    await f.host.invoke("desktop_permissions_request", { id: "location" });
    expect(f.options.nativePermission).not.toHaveBeenCalledWith(
      "location",
      true,
    );
    expect(f.options.openExternal).toHaveBeenCalledWith(
      expect.stringContaining("Privacy_LocationServices"),
    );
    expect(
      f.options.nativeInvoke.mock.calls.map(([method]) => method),
    ).not.toContain("notifications.request");
  });
  it("requests Accessibility through AX and reports real disk probe changes rather than an in-memory grant", async () => {
    const f = await fixture();
    await f.host.invoke("desktop_permissions_request", { id: "accessibility" });
    expect(f.options.nativeInvoke).toHaveBeenCalledWith(
      "accessibility.request",
    );
    f.options.diskAccess.mockResolvedValue("granted");
    expect(await f.state("fullDiskAccess")).toBe("granted");
    f.options.diskAccess.mockResolvedValue("denied");
    expect(await f.state("fullDiskAccess")).toBe("denied");
  });
  it("does not confuse a missing native service with denied permission", async () => {
    const f = await fixture();
    f.options.nativeInvoke.mockRejectedValue(new Error("missing"));
    expect(await f.state("accessibility")).toBe("unavailable");
    expect(await f.state("screenCapture")).toBe("unavailable");
  });
  it("uses Windows settings without invoking macOS APIs or pretending OS authorization", async () => {
    const f = await fixture("win32");
    expect(await f.state("accessibility")).toBe("notApplicable");
    await f.host.invoke("desktop_permissions_open_settings", { id: "camera" });
    expect(f.options.openExternal).toHaveBeenCalledWith(
      "ms-settings:privacy-webcam",
    );
    expect(f.options.nativeInvoke).not.toHaveBeenCalled();
    expect(await f.state("notifications")).toBe("unknown");
  });
});
