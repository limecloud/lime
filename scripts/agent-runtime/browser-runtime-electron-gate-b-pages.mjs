import http from "node:http";
import { WebSocketServer } from "ws";

/** Real HTTP pages owned by this fixture; navigation never depends on an external site. */
export async function startBrowserFixturePages({
  annotationFrames = false,
} = {}) {
  const cross = annotationFrames
    ? http.createServer((_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          "<!doctype html><title>Cross origin fixture</title><p>Cross origin content remains a container.</p>",
        );
      })
    : null;
  if (cross)
    await new Promise((resolve, reject) => {
      cross.once("error", reject);
      cross.listen(0, "127.0.0.1", resolve);
    });
  const crossUrl = cross
    ? `http://127.0.0.1:${cross.address().port}/cross`
    : null;
  const pages = new Map([
    ["/browser-runtime-gate-b", "Browser Runtime Gate B"],
    ["/browser-runtime-gate-b-user", "Browser User Navigation"],
  ]);
  let port = 0;
  const webSocketMessages = [];
  const webSockets = new WebSocketServer({ noServer: true });
  const server = http.createServer((request, response) => {
    const framePage =
      annotationFrames &&
      /^\/annotation-(?:frame|nested)(?:\?|$)/u.test(request.url);
    const title = framePage ? "Annotation frame" : pages.get(request.url);
    if (!title || request.method !== "GET") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": annotationFrames
        ? `default-src 'none'; connect-src ws://127.0.0.1:${port}; frame-src 'self' ${new URL(crossUrl).origin}`
        : `default-src 'none'; connect-src ws://127.0.0.1:${port}`,
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Controlled native Browser fixture.</p><a href="/browser-runtime-gate-b-user">Continue</a>${annotationFrames && !framePage ? `<iframe id="annotation-outer" src="/annotation-frame"></iframe><iframe id="annotation-cross" src="${crossUrl}"></iframe>` : ""}${framePage && request.url.startsWith("/annotation-frame") ? '<iframe id="annotation-inner" src="/annotation-nested"></iframe><section id="annotation-frame-shadow"></section><button id="frame-button">Frame button</button>' : ""}${framePage && request.url.startsWith("/annotation-nested") ? '<p id="frame-copy">First 😀 nested browser text.\nSecond 会话内置 frame line.</p>' : ""}</body></html>`,
    );
  });
  server.on("upgrade", (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.on("message", (message) => {
        webSocketMessages.push(message.toString());
        if (message.toString() === "BROWSER_CDP_WS_REQUEST")
          webSocket.send("BROWSER_CDP_WS_RESPONSE");
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;
  return {
    initialUrl: `http://127.0.0.1:${port}/browser-runtime-gate-b`,
    userUrl: `http://127.0.0.1:${port}/browser-runtime-gate-b-user`,
    webSocketUrl: `ws://127.0.0.1:${port}/browser-runtime-gate-b-socket`,
    webSocketMessages,
    close: async () => {
      for (const webSocket of webSockets.clients) webSocket.terminate();
      await new Promise((resolve) => webSockets.close(resolve));
      await Promise.all(
        [server, cross].filter(Boolean).map(
          (target) =>
            new Promise((resolve, reject) => {
              target.close((error) => (error ? reject(error) : resolve()));
              target.closeAllConnections();
            }),
        ),
      );
    },
  };
}
