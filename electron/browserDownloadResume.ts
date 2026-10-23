import type { DownloadItem } from "electron";
import {
  assertDownloadKeys,
  downloadRecord,
  nonNegative,
} from "../src/lib/api/browserDownloadsTypes";

/** Native-only facts. Neither paths nor recovery arguments cross the renderer boundary. */
export interface BrowserDownloadResumeData {
  viewId: string;
  urlChain: string[];
  eTag: string;
  lastModified: string;
  startTime: number;
}

export interface BrowserDownloadRecoveryRequest extends BrowserDownloadResumeData {
  id: string;
  path: string;
  offset: number;
  length: number;
  mimeType: string | null;
}

export function parseBrowserDownloadResume(
  value: unknown,
): BrowserDownloadResumeData | null {
  if (value === null) return null;
  const source = downloadRecord(value);
  assertDownloadKeys(source, [
    "viewId",
    "urlChain",
    "eTag",
    "lastModified",
    "startTime",
  ]);
  if (
    typeof source.viewId !== "string" ||
    !source.viewId ||
    source.viewId.length > 256 ||
    !Array.isArray(source.urlChain) ||
    !source.urlChain.length ||
    source.urlChain.length > 32 ||
    source.urlChain.some((value) => !httpDownloadUrl(value)) ||
    typeof source.eTag !== "string" ||
    source.eTag.length > 8192 ||
    /[\r\n]/u.test(source.eTag) ||
    typeof source.lastModified !== "string" ||
    source.lastModified.length > 8192 ||
    /[\r\n]/u.test(source.lastModified) ||
    typeof source.startTime !== "number" ||
    !Number.isFinite(source.startTime) ||
    source.startTime < 0 ||
    source.startTime > Number.MAX_SAFE_INTEGER
  )
    throw new Error("Invalid native download recovery facts");
  return {
    viewId: source.viewId,
    urlChain: [...source.urlChain] as string[],
    eTag: source.eTag,
    lastModified: source.lastModified,
    startTime: source.startTime,
  };
}

export function nativeBrowserDownloadResume(
  item: DownloadItem,
  viewId: string,
): BrowserDownloadResumeData | null {
  try {
    return parseBrowserDownloadResume({
      viewId,
      urlChain: item.getURLChain(),
      eTag: item.getETag(),
      lastModified: item.getLastModifiedTime(),
      startTime: item.getStartTime(),
    });
  } catch {
    // Non-HTTP downloads remain manageable without promising native recovery.
    return null;
  }
}

export function httpDownloadUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value || value.length > 65536) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function partialDownloadSize(
  size: number,
  total: number | null,
): boolean {
  return (
    nonNegative(size) &&
    size > 0 &&
    total !== null &&
    nonNegative(total) &&
    size < total
  );
}
