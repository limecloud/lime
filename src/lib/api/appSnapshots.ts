import { safeInvoke } from "@/lib/dev-bridge";

export interface AppSnapshotWindow {
  id: string;
  name: string;
  thumbnail: string;
}

export async function listAppSnapshotWindows(): Promise<AppSnapshotWindow[]> {
  const result = await safeInvoke<unknown>("list_app_snapshot_windows");
  if (!Array.isArray(result)) throw new Error("invalid app snapshot result");
  return result
    .filter(
      (item): item is AppSnapshotWindow =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.thumbnail === "string",
    )
    .map((item) => ({ ...item }));
}
