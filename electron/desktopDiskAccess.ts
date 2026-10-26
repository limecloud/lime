import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { DesktopPermissionState } from "../src/lib/api/desktopPermissionsTypes";

/** Operational access probe, following Shou NativeScanAccess. No contents are read. */
export async function readDesktopDiskAccess(): Promise<DesktopPermissionState> {
  try {
    const file = await open(
      "/Library/Application Support/com.apple.TCC/TCC.db",
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    await file.close();
    return "granted";
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "EPERM" || code === "EACCES" ? "denied" : "unknown";
  }
}
