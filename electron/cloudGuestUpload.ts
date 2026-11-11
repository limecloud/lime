import { X509Certificate } from "node:crypto";
import { request } from "node:https";
import { isIP } from "node:net";
import { pipeline } from "node:stream/promises";
import { checkServerIdentity } from "node:tls";
import type { FileHandle } from "node:fs/promises";
import { Buffer } from "node:buffer";

export type CloudGuestUpload = {
  operationId: string;
  publicAddress: string;
  certificate: string;
  expiresAt: number;
};

/** This is a temporary artifact transport, never an agent task or shell endpoint. */
export async function requestCloudGuestUpload(
  target: CloudGuestUpload,
  capability: string,
  route: "/status" | "/runtime" | "/credentials" | "/finish",
  signal: AbortSignal,
  upload?: { file: FileHandle; bytes: number },
): Promise<Record<string, unknown>> {
  try {
    if (
      isIP(target.publicAddress) !== 4 ||
      !/^[a-f0-9]{64}$/u.test(capability) ||
      !Number.isSafeInteger(target.expiresAt) ||
      target.expiresAt * 1000 <= Date.now()
    )
      throw new Error("invalid target");
    const certificate = new X509Certificate(target.certificate);
    if (!certificate.checkIP(target.publicAddress))
      throw new Error("invalid certificate identity");
    const method =
      route === "/runtime" ? "PUT" : route === "/finish" ? "POST" : "GET";
    if ((route === "/runtime") !== Boolean(upload))
      throw new Error("invalid upload");
    let responseResult!: Promise<Record<string, unknown>>;
    let resolveResponse!: (value: Record<string, unknown>) => void;
    let rejectResponse!: (error: unknown) => void;
    responseResult = new Promise((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const operation = request(
      {
        hostname: target.publicAddress,
        port: 8787,
        path: route,
        method,
        agent: false,
        ca: target.certificate,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        checkServerIdentity: (_host, cert) =>
          checkServerIdentity(target.publicAddress, cert),
        signal,
        timeout: 30_000,
        maxHeaderSize: 8192,
        headers: {
          Authorization: `Bearer ${capability}`,
          "Content-Length": upload?.bytes ?? 0,
          "Content-Type": upload ? "application/gzip" : "application/json",
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
      if (upload) {
        const sending = pipeline(
          upload.file.createReadStream({ start: 0, autoClose: false }),
          operation,
        );
        return (await Promise.all([responseResult, sending]))[0];
      }
      operation.end();
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
