import packageMetadata from "../package.json";
import { Buffer } from "node:buffer";
import {
  parseCloudGuestReceipt,
  type CloudGuestSource,
} from "./cloudGuestArtifact";

const LIMIT = 8192;
const unavailable = () => new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE");
const invalid = () => new Error("CLOUD_INSTALL_PACKAGE_INVALID");

async function officialResponse(
  canonical: string,
  method: "GET" | "HEAD",
  signal: AbortSignal,
  fetchDocument: typeof fetch,
): Promise<Response> {
  let url = new URL(canonical);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      !(
        url.href === canonical ||
        url.hostname === "release-assets.githubusercontent.com"
      )
    )
      throw invalid();
    const response = await fetchDocument(url, {
      method,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal,
      headers: {
        Accept:
          method === "GET" ? "application/json" : "application/octet-stream",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw invalid();
      url = new URL(location, url);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw unavailable();
    }
    return response;
  }
  throw invalid();
}

function fixedError(error: unknown): Error {
  // Network diagnostics may contain signed redirect URLs. Expose fixed codes only.
  return error instanceof Error &&
    error.message === "CLOUD_INSTALL_PACKAGE_INVALID"
    ? invalid()
    : unavailable();
}

/** Resolve only this application's exact release; never accept a renderer URL. */
export async function selectCloudGuestRelease(
  version: string,
  fetchDocument: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(20_000),
): Promise<CloudGuestSource> {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
    version.length > 64
  )
    throw unavailable();
  const repository = packageMetadata.repository.url
    .replace(/^git\+/u, "")
    .replace(/\.git$/u, "");
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u.test(repository))
    throw unavailable();
  const archive = `lime-guest-linux-x64-${version}.tar.gz`;
  const downloadUrl = `${repository}/releases/download/v${version}/${archive}`;
  const descriptor = downloadUrl + ".json";
  try {
    const response = await officialResponse(
      descriptor,
      "GET",
      signal,
      fetchDocument,
    );
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > LIMIT)) {
      await response.body?.cancel();
      throw invalid();
    }
    if (!response.body) throw invalid();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > LIMIT) throw invalid();
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const source = parseCloudGuestReceipt(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      archive,
    );
    if (source.downloadUrl !== downloadUrl) throw invalid();
    return source;
  } catch (error) {
    throw fixedError(error);
  }
}

/** Before billing starts, check the immutable descriptor and artifact without downloading it. */
export async function probeCloudGuestRelease(
  version: string,
  fetchDocument: typeof fetch = fetch,
): Promise<void> {
  const signal = AbortSignal.timeout(20_000);
  try {
    const source = await selectCloudGuestRelease(
      version,
      fetchDocument,
      signal,
    );
    const response = await officialResponse(
      source.downloadUrl!,
      "HEAD",
      signal,
      fetchDocument,
    );
    try {
      const length = response.headers.get("content-length");
      if (
        !length ||
        !/^\d+$/u.test(length) ||
        Number(length) !== source.artifact.archiveBytes
      )
        throw invalid();
    } finally {
      await response.body?.cancel();
    }
  } catch (error) {
    throw fixedError(error);
  }
}
