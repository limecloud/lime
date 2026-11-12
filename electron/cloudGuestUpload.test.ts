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

it("uses verified TLS, a fixed address and routes; uploads actual bytes and refuses redirects, wrong certificates and expiry", async () => {
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
      response.writeHead(mode === "redirect" ? 302 : 200, {
        "Content-Type": "application/json",
        Location: "https://never-follow.invalid/secret",
      });
      response.end(
        mode === "invalid"
          ? "secret-invalid-response"
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
  for (mode of ["redirect", "invalid"]) {
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
