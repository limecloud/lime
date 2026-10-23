import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

/** Deterministic local attachments; no stored credentials or external network. */
export async function startRestartDownloads({
  textDocument = false,
  unregisteredDocument = false,
} = {}) {
  const marker = randomUUID();
  const files = ["resume", "cancel"].map((name, index) => {
    const document = textDocument && name === "resume";
    const content = Buffer.alloc(
      (document ? 1 : 16) * 1024 * 1024,
      document ? 32 : 0,
    );
    const text = document ? `Lime browser file action ${marker}` : null;
    if (document) {
      for (let i = 79; i < content.length; i += 80) content[i] = 10;
      content.write(`${text}\n`);
    } else
      for (let i = 0; i < content.length; i++) content[i] = (i + index) % 251;
    return {
      name,
      filename: `restart-${marker}-${name}.${document ? (unregisteredDocument ? `lime-download-${marker}` : "txt") : "bin"}`,
      text,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      etag: `"restart-${marker}-${name}"`,
    };
  });
  const requests = [];
  const timers = new Set();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/owner.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<!doctype html><title>Download restart fixture</title><h1>Native browser downloads</h1>",
      );
      return;
    }
    const file = files.find((file) => pathname === `/${file.filename}`);
    if (!file || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d+)-$/u.exec(request.headers.range ?? "");
    const offset = range ? Number(range[1]) : 0;
    if ((request.headers.range && !range) || offset >= file.content.length) {
      response
        .writeHead(416, { "content-range": `bytes */${file.content.length}` })
        .end();
      return;
    }
    const record = {
      name: file.name,
      range: request.headers.range ?? null,
      ifRange: request.headers["if-range"] ?? null,
      cookiePresent:
        request.headers.cookie?.includes(
          "restart-download=controlled-fixture",
        ) === true,
      bytesWritten: 0,
      complete: false,
      closed: false,
    };
    requests.push(record);
    response.writeHead(range ? 206 : 200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "content-length": file.content.length - offset,
      "accept-ranges": "bytes",
      etag: file.etag,
      "last-modified": "Thu, 22 Oct 2026 00:00:00 GMT",
      ...(range
        ? {
            "content-range": `bytes ${offset}-${file.content.length - 1}/${file.content.length}`,
          }
        : {}),
    });
    let cursor = offset;
    const timer = setInterval(() => {
      if (response.destroyed || response.writableNeedDrain) return;
      const chunk = file.content.subarray(
        cursor,
        cursor + (file.text ? 1024 : 32 * 1024),
      );
      response.write(chunk);
      cursor += chunk.length;
      record.bytesWritten += chunk.length;
      if (cursor >= file.content.length) {
        clearInterval(timer);
        timers.delete(timer);
        record.complete = true;
        response.end();
      }
    }, 25);
    timers.add(timer);
    response.once("close", () => {
      record.closed = true;
      clearInterval(timer);
      timers.delete(timer);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const file of files) file.url = `${origin}/${file.filename}`;
  return {
    files,
    requests,
    ownerUrl: `${origin}/owner.html`,
    close: async () => {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}
