// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:https";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requestCloudGuestUpload } from "./cloudGuestUpload";

let root: string;
let server: Server;
afterEach(async () => {
  if (server?.listening)
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), "lime-upload-tls-"));
  const key = path.join(root, "key.pem");
  const cert = path.join(root, "cert.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Explicit local TLS fixture",
    "-addext",
    "subjectAltName=IP:127.0.0.2",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  const certificate = await readFile(cert, "utf8");
  const received: Array<{ route: string; auth: string; body: Buffer }> = [];
  let mode = "normal";
  server = createServer(
    { key: await readFile(key), cert: certificate },
    async (request, response) => {
      const blocks: Buffer[] = [];
      for await (const block of request) blocks.push(block);
      received.push({
        route: request.url!,
        auth: request.headers.authorization!,
        body: Buffer.concat(blocks),
      });
      if (mode === "reset") return request.socket.destroy();
      if (mode === "hang") return;
      response.writeHead(
        mode === "redirect" ? 302 : mode === "forbidden" ? 403 : 200,
        {
          "Content-Type":
            mode === "content" ? "text/plain" : "application/json",
          Location: "https://never-follow.invalid/secret",
        },
      );
      response.end(
        mode === "invalid"
          ? "secret-invalid-response"
          : mode === "size"
            ? "private-large-response".repeat(2000)
            : mode === "array"
              ? "[]"
              : JSON.stringify({ phase: "waiting" }),
      );
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing fixture address");
  const target = {
    operationId: "fixture",
    endpoint: `https://127.0.0.1:${address.port}/`,
    certificate,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  const capability = "c".repeat(64);
  return {
    target,
    capability,
    received,
    setMode: (value: string) => {
      mode = value;
    },
  };
}

it("uses verified TLS, a fixed address and routes; uploads actual bytes and refuses redirects, wrong certificates and expiry", async () => {
  const { target, capability, received, setMode } = await fixture();
  await expect(
    requestCloudGuestUpload(
      target,
      capability,
      "/status",
      new AbortController().signal,
    ),
  ).resolves.toEqual({ phase: "waiting" });
  const archive = path.join(root, "artifact.tar.gz");
  const bytes = Buffer.from("synthetic-upload-content");
  await writeFile(archive, bytes);
  const file = await open(archive);
  try {
    await requestCloudGuestUpload(
      target,
      capability,
      "/runtime",
      new AbortController().signal,
      { file, bytes: bytes.length },
    );
  } finally {
    await file.close();
  }
  expect(received.map(({ route }) => route)).toEqual(["/status", "/runtime"]);
  expect(received[1].body).toEqual(bytes);
  expect(received[1].auth).toBe(`Bearer ${capability}`);
  const downloadUrl =
    "https://assets.example.com/runtime.tar.gz?signature=synthetic-private-query";
  await requestCloudGuestUpload(
    target,
    capability,
    "/download",
    new AbortController().signal,
    { downloadUrl },
  );
  expect(received[2].route).toBe("/download");
  expect(JSON.parse(received[2].body.toString())).toEqual({ downloadUrl });
  expect(received[2].auth).toBe(`Bearer ${capability}`);
  for (const mode of ["redirect", "invalid"]) {
    setMode(mode);
    await expect(
      requestCloudGuestUpload(
        target,
        capability,
        "/status",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/^CLOUD_INSTALL_CONNECTION_FAILED$/u);
  }
  const count = received.length;
  for (const change of [
    { endpoint: "https://localhost:8788/" },
    { endpoint: "https://8.8.8.8:8788/" },
    { endpoint: "https://user:secret@127.0.0.1:8788/" },
    { endpoint: "https://127.0.0.2:8787/" },
    { certificate: "invalid-secret-certificate" },
    { expiresAt: 1 },
  ]) {
    await expect(
      requestCloudGuestUpload(
        { ...target, ...change },
        capability,
        "/status",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/^CLOUD_INSTALL_CONNECTION_FAILED$/u);
  }
  expect(received).toHaveLength(count);
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    requestCloudGuestUpload(target, capability, "/status", aborted.signal),
  ).rejects.toThrow(/^CLOUD_INSTALL_CONNECTION_FAILED$/u);
  expect(received).toHaveLength(count);
}, 20_000);

it("classifies real TLS/HTTP/connection failures without exposing private response or target data", async () => {
  const { target, capability, setMode } = await fixture();
  for (const [mode, reason, httpStatus] of [
    ["redirect", "httpStatus", 302],
    ["forbidden", "httpStatus", 403],
    ["content", "responseType"],
    ["invalid", "responseJson"],
    ["size", "responseSize"],
    ["array", "responseShape"],
    ["reset", "connection"],
  ] as const) {
    setMode(mode);
    const error = await requestCloudGuestUpload(
      target,
      capability,
      "/status",
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: "CLOUD_INSTALL_CONNECTION_FAILED",
      failure: {
        route: "/status",
        reason,
        ...(httpStatus === undefined ? {} : { httpStatus }),
      },
    });
    expect(JSON.stringify(error)).not.toMatch(
      /secret|private|127\.0\.0|Bearer|BEGIN CERTIFICATE/u,
    );
    expect(error).not.toHaveProperty("cause");
  }
  const cert = path.join(root, "untrusted-cert.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Explicit untrusted TLS fixture",
    "-addext",
    "subjectAltName=IP:127.0.0.2",
    "-keyout",
    path.join(root, "untrusted-key.pem"),
    "-out",
    cert,
  ]);
  setMode("normal");
  await expect(
    requestCloudGuestUpload(
      { ...target, certificate: await readFile(cert, "utf8") },
      capability,
      "/status",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({
    message: "CLOUD_INSTALL_CONNECTION_FAILED",
    failure: { route: "/status", reason: "tls" },
  });
});

it("distinguishes local validation, cancellation and expiry, including expiry during an in-flight TLS request", async () => {
  const { target, capability, received, setMode } = await fixture();
  for (const [change, reason] of [
    [
      { endpoint: "https://user:private-password@127.0.0.1:8788/" },
      "invalidTarget",
    ],
    [{ certificate: "private-invalid-certificate" }, "invalidTarget"],
    [{ expiresAt: 1 }, "expired"],
  ] as const) {
    await expect(
      requestCloudGuestUpload(
        { ...target, ...change },
        capability,
        "/status",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ failure: { route: "/status", reason } });
  }
  await expect(
    requestCloudGuestUpload(
      target,
      capability,
      "/download",
      new AbortController().signal,
      { downloadUrl: "http://private.invalid/?private-token" },
    ),
  ).rejects.toMatchObject({
    failure: { route: "/download", reason: "invalidTarget" },
  });
  const cancelled = new AbortController();
  cancelled.abort("private-cancellation-reason");
  await expect(
    requestCloudGuestUpload(target, capability, "/status", cancelled.signal),
  ).rejects.toMatchObject({
    failure: { route: "/status", reason: "cancelled" },
  });
  expect(received).toHaveLength(0);
  setMode("hang");
  await expect(
    requestCloudGuestUpload(
      { ...target, expiresAt: Math.ceil(Date.now() / 1000) + 1 },
      capability,
      "/status",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ failure: { route: "/status", reason: "expired" } });
  expect(received).toHaveLength(1);
  const inFlight = new AbortController();
  const pending = expect(
    requestCloudGuestUpload(target, capability, "/status", inFlight.signal),
  ).rejects.toMatchObject({
    failure: { route: "/status", reason: "cancelled" },
  });
  await expect.poll(() => received.length).toBe(2);
  inFlight.abort("private-in-flight-cancellation-reason");
  await pending;
});

it("classifies real request inactivity as timeout while the installation lease remains valid", async () => {
  const { target, capability, setMode } = await fixture();
  setMode("hang");
  await expect(
    requestCloudGuestUpload(
      target,
      capability,
      "/status",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({
    message: "CLOUD_INSTALL_CONNECTION_FAILED",
    failure: { route: "/status", reason: "timeout" },
  });
  expect(target.expiresAt * 1000).toBeGreaterThan(Date.now());
}, 35_000);
