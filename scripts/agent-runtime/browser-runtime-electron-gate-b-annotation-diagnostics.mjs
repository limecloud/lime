import { sleep } from "./claw-chat-current-fixture-utils.mjs";

/** Observe real IPC without replacing its result or granting a test capability. */
export async function observeBrowserAnnotationInputs(app, key) {
  await app.evaluate(({ ipcMain, BrowserWindow }, key) => {
    const { execFileSync } = process.getBuiltinModule("node:child_process");
    const { createHash } = process.getBuiltinModule("node:crypto");
    const digest = (value) =>
      typeof value === "string"
        ? createHash("sha256").update(value).digest("hex")
        : null;
    const foreground = () => {
      if (process.platform !== "darwin") return null;
      try {
        const asn = execFileSync("/usr/bin/lsappinfo", ["front"], {
          encoding: "utf8",
          timeout: 1000,
        }).trim();
        const info = execFileSync(
          "/usr/bin/lsappinfo",
          ["info", "-only", "pid,bundleid,name", asn],
          { encoding: "utf8", timeout: 1000 },
        );
        return {
          pid: Number(/"pid"=(\d+)/u.exec(info)?.[1]) || null,
          bundleId: /"CFBundleIdentifier"="([^"]+)"/u.exec(info)?.[1] ?? null,
          name: /"LSDisplayName"="([^"]+)"/u.exec(info)?.[1] ?? null,
        };
      } catch (error) {
        return { diagnosticError: String(error).slice(0, 300) };
      }
    };
    const records = [];
    const commands = [];
    const listeners = [
      "browser-annotation-page-event",
      "lime:browser-annotation-editor",
    ].map((channel) => {
      const listener = (event, value) => {
        if (!value || typeof value !== "object") return;
        records.push({
          timestamp: Date.now(),
          channel,
          senderId: event.sender.id,
          senderUrl: event.sender.getURL(),
          mainFrame: event.senderFrame === event.sender.mainFrame,
          kind: value.kind ?? value.type,
          action: value.action ?? null,
          annotationId: value.annotationId ?? null,
          pageRevision: value.pageRevision ?? null,
          tokenDigest: digest(value.token),
          documentDigest: digest(value.documentToken),
          editorId: value.editorId ?? null,
          generation: value.generation ?? null,
          revision: value.revision ?? null,
          bodyLength: typeof value.body === "string" ? value.body.length : null,
          designChange: value.designChange
            ? structuredClone(value.designChange)
            : null,
          status: value.status ?? null,
          anchor:
            value.type === "anchor" ? structuredClone(value.anchor) : null,
        });
      };
      ipcMain.on(channel, listener);
      return { channel, listener };
    });
    const windows = BrowserWindow.getAllWindows().flatMap((window) =>
      ["blur", "focus", "resize"].map((kind) => {
        const listener = () =>
          records.push({
            timestamp: Date.now(),
            channel: "native-window",
            kind,
            windowId: window.id,
            focused: window.isFocused(),
            ownPid: process.pid,
            foreground: foreground(),
          });
        window.on(kind, listener);
        return { window, kind, listener };
      }),
    );
    const projections = BrowserWindow.getAllWindows().map((window) => {
      const contents = window.webContents;
      const descriptor = Object.getOwnPropertyDescriptor(contents, "send");
      const originalSend = contents.send;
      const observedSend = function (channel, ...args) {
        if (channel === "evt:browser-tab-annotation-cancelled") {
          const value = args[0]?.payload;
          records.push({
            timestamp: Date.now(),
            channel: "browser-annotation-cancelled-projection",
            receiverId: contents.id,
            annotationId: value?.annotationId ?? null,
            pageRevision: value?.pageRevision ?? null,
            reason: value?.reason ?? null,
          });
        }
        if (channel === "evt:browser-tab-annotation-editor") {
          const value = args[0]?.payload;
          records.push({
            timestamp: Date.now(),
            channel: "browser-annotation-editor-projection",
            receiverId: contents.id,
            action: value?.action ?? null,
            editorId: value?.editorId ?? null,
            draftId: value?.draftId ?? null,
            generation: value?.generation ?? null,
            revision: value?.revision ?? null,
            bodyLength:
              typeof value?.body === "string" ? value.body.length : null,
            designChange: value?.designChange
              ? structuredClone(value.designChange)
              : null,
          });
        }
        return Reflect.apply(originalSend, this, [channel, ...args]);
      };
      contents.send = observedSend;
      return { contents, descriptor, observedSend };
    });
    // Electron's handler map is used only by this pinned-runtime diagnostic fixture.
    const handlers = ipcMain._invokeHandlers;
    const original = handlers?.get("app:invoke");
    if (typeof original !== "function")
      throw new Error(
        "Real host invoke handler unavailable for annotation observation",
      );
    const observed = async (event, command, ...args) => {
      const mediaRequest =
        command === "app_server_handle_json_lines" &&
        args[0]?.request?.lines?.some((line) => {
          try {
            return JSON.parse(line).method === "media/read";
          } catch {
            return false;
          }
        });
      if (!String(command).includes("annotation") && !mediaRequest)
        return original(event, command, ...args);
      const record = { command, status: "pending" };
      commands.push(record);
      try {
        const response = await original(event, command, ...args);
        const result = response?.result;
        if (mediaRequest) {
          record.media = result?.lines?.flatMap((line) => {
            try {
              const message = JSON.parse(line);
              return message.error
                ? [{ error: message.error }]
                : message.result?.contentBase64
                  ? [
                      {
                        mimeType: message.result.mimeType,
                        bytes: message.result.bytes,
                        totalBytes: message.result.totalBytes,
                        offset: message.result.offset,
                        hasMore: message.result.hasMore,
                      },
                    ]
                  : [];
            } catch {
              return [];
            }
          });
        }
        Object.assign(record, {
          status: response?.ok ? "success" : "error",
          error: response?.error?.message,
          screenshotStatus: result?.screenshotStatus,
          failureReason: result?.failureReason,
          selection: result?.selection
            ? structuredClone(result.selection)
            : null,
          visible: result?.visible,
          generation: result?.generation,
          screenshot: result?.screenshot
            ? {
                width: result.screenshot.width,
                height: result.screenshot.height,
                kind: result.screenshot.kind,
                sha256:
                  typeof result.screenshot.dataUrl === "string"
                    ? createHash("sha256")
                        .update(
                          Buffer.from(
                            result.screenshot.dataUrl.split(",")[1],
                            "base64",
                          ),
                        )
                        .digest("hex")
                    : null,
              }
            : null,
        });
        return response;
      } catch (error) {
        Object.assign(record, { status: "error", error: String(error) });
        throw error;
      }
    };
    handlers.set("app:invoke", observed);
    globalThis[key] = {
      records,
      commands,
      close: () => {
        listeners.forEach(({ channel, listener }) =>
          ipcMain.off(channel, listener),
        );
        windows.forEach(({ window, kind, listener }) =>
          window.off(kind, listener),
        );
        projections.forEach(({ contents, descriptor, observedSend }) => {
          if (contents.send !== observedSend) return;
          if (descriptor) Object.defineProperty(contents, "send", descriptor);
          else delete contents.send;
        });
        if (handlers.get("app:invoke") === observed)
          handlers.set("app:invoke", original);
      },
    };
  }, key);
}

export async function readBrowserAnnotationCommands(app, key) {
  return app
    .evaluate((_electron, key) => globalThis[key]?.commands ?? [], key)
    .catch(() => []);
}

export async function waitForBrowserAnnotationState(
  options,
  read,
  predicate,
  description,
  summarize = (value) => value,
) {
  const deadline = Date.now() + options.timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(options.intervalMs);
  }
  throw new Error(`${description}: ${JSON.stringify(summarize(last))}`);
}

export async function readBrowserAnnotationNativeIdentity(app, webContentsId) {
  return app.evaluate(({ BrowserWindow, webContents }, id) => {
    const target = webContents.fromId(id);
    if (!target || target.isDestroyed()) return null;
    const find = (view) =>
      view.webContents?.id === id
        ? view
        : view.children.map(find).find(Boolean);
    const window = BrowserWindow.getAllWindows().find((window) =>
      find(window.contentView),
    );
    const view = window ? find(window.contentView) : null;
    return {
      webContentsId: target.id,
      url: target.getURL(),
      windowId: window?.id ?? null,
      ownerWebContentsId: window?.webContents.id ?? null,
      bounds: view?.getBounds() ?? null,
      visible: view?.getVisible() ?? false,
    };
  }, webContentsId);
}

export async function waitForBrowserAnnotationNativePage(
  app,
  options,
  predicate,
  description,
) {
  return waitForBrowserAnnotationState(
    options,
    async () => {
      for (const candidate of app.context().pages()) {
        if (candidate.isClosed() || !predicate(candidate.url())) continue;
        const cdp = await app.context().newCDPSession(candidate);
        try {
          const { targetInfo } = await cdp.send("Target.getTargetInfo");
          const id = await app.evaluate(
            ({ webContents }, targetId) =>
              webContents.fromDevToolsTargetId(targetId)?.id ?? null,
            targetInfo.targetId,
          );
          if (id)
            return {
              page: candidate,
              native: await readBrowserAnnotationNativeIdentity(app, id),
            };
        } finally {
          await cdp.detach();
        }
      }
      return null;
    },
    (value) => !!value?.native?.bounds,
    description,
  );
}
