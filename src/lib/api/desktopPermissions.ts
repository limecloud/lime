import { safeInvoke } from "@/lib/dev-bridge";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";
import { assertEmptyElectronHostResult } from "./electronHostResult";
import {
  parseAutomationTargets,
  parseDesktopPermissions,
  type DesktopPermissionId,
} from "./desktopPermissionsTypes";
export type {
  DesktopPermissionId,
  DesktopPermissionState,
  DesktopPermissionsSnapshot,
  AutomationTarget,
} from "./desktopPermissionsTypes";

async function invoke(command: string, args?: Record<string, unknown>) {
  const result = await safeInvoke<unknown>(command, args);
  assertNotDiagnosticFacade(command, result, "Desktop OS permissions host");
  return result;
}
export async function readDesktopPermissions(targetBundleId?: string) {
  return parseDesktopPermissions(
    await invoke(
      "desktop_permissions_read",
      targetBundleId ? { targetBundleId } : {},
    ),
  );
}
export async function requestDesktopPermission(
  id: DesktopPermissionId,
  targetBundleId?: string,
) {
  return parseDesktopPermissions(
    await invoke("desktop_permissions_request", {
      id,
      ...(targetBundleId ? { targetBundleId } : {}),
    }),
  );
}
export async function openDesktopPermissionSettings(id: DesktopPermissionId) {
  assertEmptyElectronHostResult(
    "desktop_permissions_open_settings",
    await invoke("desktop_permissions_open_settings", { id }),
  );
}
export async function readAutomationTargets() {
  return parseAutomationTargets(await invoke("desktop_permissions_targets"));
}
export async function completeDesktopPermissionsSetup() {
  assertEmptyElectronHostResult(
    "desktop_permissions_complete",
    await invoke("desktop_permissions_complete"),
  );
}
