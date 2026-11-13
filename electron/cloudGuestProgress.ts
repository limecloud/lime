import type { CloudGuestInstallationStatus } from "../src/lib/desktop-host/cloudDesktopConnection";

type Transfer = NonNullable<CloudGuestInstallationStatus["transfer"]>;

/** Bind remote counters to the original trusted artifact, never remote totals. */
export function readCloudGuestProgress(
  value: unknown,
  expectedBytes: number | undefined,
  previous?: Transfer,
): Transfer | undefined {
  if (value === undefined) return previous;
  const item = value as Transfer | null;
  if (
    !item ||
    expectedBytes === undefined ||
    !Number.isSafeInteger(item.receivedBytes) ||
    !Number.isSafeInteger(item.totalBytes) ||
    item.totalBytes !== expectedBytes ||
    item.receivedBytes < 0 ||
    item.receivedBytes > expectedBytes ||
    (previous && item.receivedBytes < previous.receivedBytes)
  )
    throw new Error("CLOUD_INSTALL_STATE_INVALID");
  return { receivedBytes: item.receivedBytes, totalBytes: expectedBytes };
}
