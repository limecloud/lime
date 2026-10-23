import type { BrowserDownloadEntry } from "@/lib/api/browserDownloads";

export const isFinishedDownload = (entry: BrowserDownloadEntry) =>
  entry.state === "completed" ||
  entry.state === "cancelled" ||
  (entry.state === "interrupted" && !entry.canResume && !entry.canCancel);
