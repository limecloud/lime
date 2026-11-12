import { X509Certificate } from "node:crypto";
import { request } from "node:https";
import { pipeline } from "node:stream/promises";
import { checkServerIdentity } from "node:tls";
import type { FileHandle } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { validateDownloadUrl } from "./cloudGuestArtifact";

export type CloudGuestUpload = {
  operationId: string;
  certificate: string;
  expiresAt: number;
};

/** This is a temporary artifact transport, never an agent task or shell endpoint. */
export async function requestCloudGuestUpload(
  target: CloudGuestUpload & { endpoint: string },
  capability: string,
  route:
    | "/status"
    | "/runtime"
    | "/credentials"
    | "/finish"
    | "/reconnect"
    | "/download",
  signal: AbortSignal,
  upload?: { file: FileHandle; bytes: number } | { downloadUrl: string },
): Promise<Record<string, unknown>> {
  try {
    const endpoint = new URL(target.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== "127.0.0.1" ||
      !endpoint.port ||
      Number(endpoint.port) === 0 ||
      endpoint.pathname !== "/" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !/^[a-f0-9]{64}$/u.test(capability) ||
      !Number.isSafeInteger(target.expiresAt) ||
      target.expiresAt * 1000 <= Date.now()
    )
      throw new Error("invalid target");
    const certificate = new X509Certificate(target.certificate);
    if (!certificate.checkIP("127.0.0.2"))
      throw new Error("invalid certificate identity");
    const method =
      route === "/runtime"
        ? "PUT"
        : route === "/finish" || route === "/reconnect" || route === "/download"
          ? "POST"
          : "GET";
    const fileUpload = upload && "file" in upload ? upload : undefined;
    const download = upload && "downloadUrl" in upload ? upload : undefined;
    if (
      (route === "/runtime") !== Boolean(fileUpload) ||
      (route === "/download") !== Boolean(download)
    )
      throw new Error("invalid upload");
    const body = download
      ? Buffer.from(
          JSON.stringify({
            downloadUrl: validateDownloadUrl(download.downloadUrl),
          }),
        )
      : undefined;
    let responseResult!: Promise<Record<string, unknown>>;
    let resolveResponse!: (value: Record<string, unknown>) => void;
    let rejectResponse!: (error: unknown) => void;
    responseResult = new Promise((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const operation = request(
      {
        hostname: "127.0.0.1",
        port: Number(endpoint.port),
        path: route,
        method,
        agent: false,
        ca: target.certificate,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        checkServerIdentity: (_host, cert) =>
          checkServerIdentity("127.0.0.2", cert),
        signal,
        timeout: 30_000,
        maxHeaderSize: 8192,
        headers: {
          Authorization: `Bearer ${capability}`,
          "Content-Length": fileUpload?.bytes ?? body?.length ?? 0,
          "Content-Type": fileUpload ? "application/gzip" : "application/json",
        },
      },
      (response) => {
        void (async () => {
          try {
            if (
              response.statusCode !== 200 ||
              !response.headers["content-type"]?.startsWith("application/json")
            )
              throw new Error("invalid response");
            const blocks: Buffer[] = [];
            let size = 0;
            for await (const block of response) {
              const bytes = Buffer.isBuffer(block) ? block : Buffer.from(block);
              size += bytes.length;
              if (size > 16384) throw new Error("response too large");
              blocks.push(bytes);
            }
            const value = JSON.parse(
              Buffer.concat(blocks).toString("utf8"),
            ) as unknown;
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw new Error("invalid response");
            resolveResponse(value as Record<string, unknown>);
          } catch (error) {
            response.destroy();
            rejectResponse(error);
          }
        })();
      },
    );
    operation.on("error", rejectResponse);
    operation.on("timeout", () =>
      operation.destroy(new Error("installation timed out")),
    );
    const timer = setTimeout(
      () => operation.destroy(new Error("installation expired")),
      Math.min(600_000, target.expiresAt * 1000 - Date.now()),
    );
    try {
      if (fileUpload) {
        const sending = pipeline(
          fileUpload.file.createReadStream({ start: 0, autoClose: false }),
          operation,
        );
        return (await Promise.all([responseResult, sending]))[0];
      }
      operation.end(body);
      return await responseResult;
    } finally {
      clearTimeout(timer);
      operation.destroy();
    }
  } catch {
    // Never forward a network error, endpoint, certificate, header or response body.
    throw new Error("CLOUD_INSTALL_CONNECTION_FAILED");
  }
}
