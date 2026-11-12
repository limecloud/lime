import { getElectronHostBridge } from "../electron-host";
import type {
  CloudArchiveDownloadResult,
  CloudArchiveRestoreResult,
  CloudDesktopConnectionMetadata,
  CloudDesktopConnectionRequest,
  CloudDesktopWindowStatus,
  CloudDesktopViewConnection,
  CloudGuestInstallationStatus,
  CloudGuestReleaseStatus,
  CloudReleaseBackupResult,
  CloudReleaseWithBackupResult,
} from "../desktop-host/cloudDesktopConnection";

export async function configureCloudDesktopConnection(
  request: CloudDesktopConnectionRequest,
): Promise<
  | CloudDesktopConnectionMetadata
  | CloudGuestInstallationStatus
  | CloudGuestReleaseStatus
  | CloudArchiveDownloadResult
  | CloudArchiveRestoreResult
  | CloudReleaseBackupResult
  | CloudReleaseWithBackupResult
  | { opened: true }
  | { deleted: boolean }
> {
  const bridge = getElectronHostBridge();
  if (!bridge || bridge.cloudDesktop)
    throw new Error(
      "cloud desktop connections require the local Desktop window",
    );
  return bridge.invoke("cloud_desktop_connection", { request });
}

export async function readCloudDesktopWindowStatus(): Promise<CloudDesktopWindowStatus> {
  const bridge = getElectronHostBridge();
  if (!bridge?.cloudDesktop)
    throw new Error("cloud desktop window is unavailable");
  return bridge.invoke("cloud_desktop_window_status");
}

export async function reconnectCloudDesktopWindow(): Promise<CloudDesktopWindowStatus> {
  const bridge = getElectronHostBridge();
  if (!bridge?.cloudDesktop)
    throw new Error("cloud desktop window is unavailable");
  return bridge.invoke("cloud_desktop_window_reconnect");
}

export async function connectCloudDesktopView(): Promise<CloudDesktopViewConnection> {
  const bridge = getElectronHostBridge();
  if (!bridge?.cloudDesktop)
    throw new Error("cloud desktop window is unavailable");
  return bridge.invoke("cloud_desktop_window_view", {
    request: { action: "connect" },
  });
}

export async function showCloudDesktopViewPassword(): Promise<void> {
  const bridge = getElectronHostBridge();
  if (!bridge?.cloudDesktop)
    throw new Error("cloud desktop window is unavailable");
  await bridge.invoke("cloud_desktop_window_view", {
    request: { action: "showPassword" },
  });
}
