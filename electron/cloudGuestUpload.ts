import { X509Certificate } from "node:crypto";
import { request } from "node:https";
import { pipeline } from "node:stream/promises";
import { checkServerIdentity } from "node:tls";
import type { FileHandle } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { validateDownloadUrl } from "./cloudGuestArtifact";
import type { CloudGuestUploadFailure } from "../src/lib/desktop-host/cloudDesktopConnection";

const routes: CloudGuestUploadFailure["route"][] = [
  "/status",
  "/runtime",
  "/credentials",
  "/finish",
  "/reconnect",
  "/download",
];
const reasons: CloudGuestUploadFailure["reason"][] = [
  "invalidTarget",
  "cancelled",
  "expired",
  "timeout",
  "tls",
  "connection",
  "httpStatus",
  "responseType",
  "responseSize",
  "responseJson",
  "responseShape",
  "unexpected",
];

/** Reconstruct only allowlisted values, including when reading private state. */
export function readCloudGuestUploadFailure(
  value: unknown,
): CloudGuestUploadFailure {
  const failure = value as CloudGuestUploadFailure | null;
  if (
    !failure ||
    !routes.includes(failure.route) ||
    !reasons.includes(failure.reason) ||
    (failure.reason === "httpStatus"
      ? !Number.isInteger(failure.httpStatus) ||
        failure.httpStatus! < 100 ||
        failure.httpStatus! > 599
      : failure.httpStatus !== undefined)
  )
    throw new Error("CLOUD_INSTALL_STATE_INVALID");
  return {
    route: failure.route,
    reason: failure.reason,
    ...(failure.reason === "httpStatus"
      ? { httpStatus: failure.httpStatus }
      : {}),
  };
}

export class CloudGuestUploadError extends Error {
  readonly failure: CloudGuestUploadFailure;
  constructor(failure: CloudGuestUploadFailure) {
    super("CLOUD_INSTALL_CONNECTION_FAILED");
    this.failure = readCloudGuestUploadFailure(failure);
  }
}

function failureReason(error: unknown): CloudGuestUploadFailure["reason"] {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ABORT_ERR") return "cancelled";
  if (code === "ETIMEDOUT") return "timeout";
  if (typeof code !== "string") return "unexpected";
  if (
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "CERT_HAS_EXPIRED",
      "CERT_NOT_YET_VALID",
      "CERT_REVOKED",
      "CERT_UNTRUSTED",
      "INVALID_CA",
    ].includes(code)
  )
    return "tls";
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ECONNABORTED",
  ].includes(code)
    ? "connection"
    : "unexpected";
}

export type CloudGuestUpload = {
  operationId: string;
  certificate: string;
  expiresAt: number;
};

/** This is a temporary artifact transport, never an agent task or shell endpoint. */
export async function requestCloudGuestUpload(
  target: CloudGuestUpload & { endpoint: string },
  capability: string,
  route: CloudGuestUploadFailure["route"],
  signal: AbortSignal,
  upload?: { file: FileHandle; bytes: number } | { downloadUrl: string },
): Promise<Record<string, unknown>> {
  if (!routes.includes(route))
    throw new Error("CLOUD_INSTALL_CONNECTION_FAILED");
  const failure = (
    reason: CloudGuestUploadFailure["reason"],
    httpStatus?: number,
  ) =>
    new CloudGuestUploadError({
      route,
      reason,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  try {
    // Validation failures are local and must not be classified as network errors.
    let endpoint: URL;
    let certificate: X509Certificate;
    try {
      endpoint = new URL(target.endpoint);
      certificate = new X509Certificate(target.certificate);
    } catch {
      throw failure("invalidTarget");
    }
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
      !Number.isSafeInteger(target.expiresAt)
    )
      throw failure("invalidTarget");
    if (!certificate.checkIP("127.0.0.2")) throw failure("invalidTarget");
    if (target.expiresAt * 1000 <= Date.now()) throw failure("expired");
    if (signal.aborted) throw failure("cancelled");
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
      throw failure("invalidTarget");
    let body: Buffer | undefined;
    if (download) {
      try {
        body = Buffer.from(
          JSON.stringify({
            downloadUrl: validateDownloadUrl(download.downloadUrl),
          }),
        );
      } catch {
        throw failure("invalidTarget");
      }
    }
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
            if (response.statusCode !== 200)
              throw failure("httpStatus", response.statusCode);
            if (
              !response.headers["content-type"]?.startsWith("application/json")
            )
              throw failure("responseType");
            const blocks: Buffer[] = [];
            let size = 0;
            for await (const block of response) {
              const bytes = Buffer.isBuffer(block) ? block : Buffer.from(block);
              size += bytes.length;
              if (size > 16384) throw failure("responseSize");
              blocks.push(bytes);
            }
            let value: unknown;
            try {
              value = JSON.parse(Buffer.concat(blocks).toString("utf8"));
            } catch {
              throw failure("responseJson");
            }
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw failure("responseShape");
            resolveResponse(value as Record<string, unknown>);
          } catch (error) {
            response.destroy();
            rejectResponse(error);
          }
        })();
      },
    );
    operation.on("error", rejectResponse);
    operation.on("timeout", () => operation.destroy(failure("timeout")));
    const timer = setTimeout(
      () =>
        operation.destroy(
          failure(
            target.expiresAt * 1000 <= Date.now() ? "expired" : "timeout",
          ),
        ),
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
  } catch (error) {
    // Never forward a network error, endpoint, certificate, header or response body.
    if (error instanceof CloudGuestUploadError) throw error;
    throw failure(failureReason(error));
  }
}
