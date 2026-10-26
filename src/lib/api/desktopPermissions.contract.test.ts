import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { ELECTRON_HOST_COMMANDS } from "../../../electron/ipcChannels";
import { DESKTOP_PERMISSIONS_COMMANDS, DESKTOP_PERMISSION_IDS } from "./desktopPermissionsTypes";
import { readDesktopPermissions, requestDesktopPermission, completeDesktopPermissionsSetup, readAutomationTargets } from "./desktopPermissions";

vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: vi.fn() }));
const snapshot = () => ({ platform: "darwin", setupComplete: false, applicationPath: "/Applications/Lime.app", nativeApplicationId: null, selectedDirectory: null,
  permissions: DESKTOP_PERMISSION_IDS.map((id) => ({ id, state: "unknown", canRequest: false, canOpenSettings: true })) });
beforeEach(() => vi.clearAllMocks());
describe("desktop permissions bridge", () => {
  it("uses registered IPC commands and retains explicit automation scope", async () => {
    for (const command of DESKTOP_PERMISSIONS_COMMANDS) expect(ELECTRON_HOST_COMMANDS).toContain(command);
    vi.mocked(safeInvoke).mockResolvedValue(snapshot());
    await requestDesktopPermission("automation", "app.test");
    expect(safeInvoke).toHaveBeenCalledWith("desktop_permissions_request", { id: "automation", targetBundleId: "app.test" });
  });
  it("rejects missing, duplicated, and invented permission status instead of presenting success", async () => {
    const missing = snapshot(); missing.permissions.pop();
    const duplicate = snapshot(); duplicate.permissions[0] = duplicate.permissions[1];
    const invented = snapshot(); invented.permissions[0].state = "enabled";
    for (const value of [missing, duplicate, invented, null, { ok: true }]) {
      vi.mocked(safeInvoke).mockResolvedValueOnce(value); await expect(readDesktopPermissions()).rejects.toThrow();
    }
  });
  it("does not accept diagnostic or malformed completion responses", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ diagnostic: { category: "electron-diagnostic-facade", source: "electron-host-diagnostic" } });
    await expect(readDesktopPermissions()).rejects.toThrow();
    vi.mocked(safeInvoke).mockResolvedValueOnce({ success: true }); await expect(completeDesktopPermissionsSetup()).rejects.toThrow();
  });
  it("validates native target identities before exposing them to selection", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([{ bundleId: "../../application", name: "Other" }]);
    await expect(readAutomationTargets()).rejects.toThrow();
  });
});
