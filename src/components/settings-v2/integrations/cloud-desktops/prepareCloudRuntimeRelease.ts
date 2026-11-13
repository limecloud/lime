import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import type { CloudGuestPreparationStatus } from "@/lib/desktop-host/cloudDesktopConnection";

/** Polls safe Main-owned progress; never receives a path, URL or credential. */
export async function prepareCloudRuntimeRelease(
  current: () => boolean,
  progress: (status: CloudGuestPreparationStatus) => void,
  context: { profile: string; regionId: string },
): Promise<boolean> {
  let action: "prepareRuntimeRelease" | "runtimeReleaseStatus" =
    "prepareRuntimeRelease";
  const deadline = Date.now() + 32 * 60_000;
  let version: string | undefined;
  for (;;) {
    if (!current()) return false;
    const status = await configureCloudDesktopConnection({
      action,
      ...context,
    });
    if (!current()) return false;
    if (
      !("kind" in status) ||
      status.kind !== "guestPreparation" ||
      typeof status.version !== "string" ||
      !status.version ||
      status.version.length > 64 ||
      (version !== undefined && status.version !== version) ||
      ![
        "idle",
        "checking",
        "downloading",
        "verifying",
        "distributing",
        "ready",
        "failed",
      ].includes(status.phase) ||
      typeof status.busy !== "boolean" ||
      (status.totalBytes !== undefined &&
        (!Number.isSafeInteger(status.totalBytes) ||
          status.totalBytes < 1 ||
          status.totalBytes > 1024 ** 3)) ||
      (status.receivedBytes !== undefined &&
        (!Number.isSafeInteger(status.receivedBytes) ||
          status.receivedBytes < 0 ||
          status.totalBytes === undefined ||
          status.receivedBytes > status.totalBytes))
    )
      throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
    version ??= status.version;
    progress(status);
    if (status.phase === "ready" && !status.busy) return true;
    if (!status.busy || status.phase === "failed" || Date.now() >= deadline)
      throw new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE");
    action = "runtimeReleaseStatus";
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}
