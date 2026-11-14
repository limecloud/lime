import { desktopCapturer } from "electron";

export interface AppSnapshotWindow {
  id: string;
  name: string;
  thumbnail: string;
}

export async function listAppSnapshotWindows(): Promise<AppSnapshotWindow[]> {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((source) => source.name.trim() && !source.name.includes("Lime"))
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
}
