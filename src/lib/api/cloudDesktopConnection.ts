import { getElectronHostBridge } from "../electron-host";
import type {
  CloudArchiveDownloadResult,
  CloudArchiveRestoreResult,
  CloudDesktopConnectionMetadata,
  CloudDesktopConnectionRequest,
  CloudDesktopWindowStatus,
  CloudGuestInstallationStatus,
} from "../desktop-host/cloudDesktopConnection";

export async function configureCloudDesktopConnection(
  request: CloudDesktopConnectionRequest,
): Promise<
  | CloudDesktopConnectionMetadata
  | CloudGuestInstallationStatus
  | CloudArchiveDownloadResult
  | CloudArchiveRestoreResult
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
