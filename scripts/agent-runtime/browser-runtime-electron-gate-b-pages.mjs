import http from "node:http";

/** Real HTTP pages owned by this fixture; navigation never depends on an external site. */
export async function startBrowserFixturePages() {
  const pages = new Map([
    ["/browser-runtime-gate-b", "Browser Runtime Gate B"],
    ["/browser-runtime-gate-b-user", "Browser User Navigation"],
  ]);
  const server = http.createServer((request, response) => {
    const title = pages.get(request.url);
    if (!title || request.method !== "GET") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Controlled native Browser fixture.</p><a href="/browser-runtime-gate-b-user">Continue</a></body></html>`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    initialUrl: `http://127.0.0.1:${port}/browser-runtime-gate-b`,
    userUrl: `http://127.0.0.1:${port}/browser-runtime-gate-b-user`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
