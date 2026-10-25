/// <reference lib="dom" />
import { createHash } from "node:crypto";
import type { WebContents } from "electron";
import {
  browserNodeInputPoint,
  runBrowserInput,
  withBrowserInputNode,
  type BrowserInputContext,
  type BrowserInputCommand,
} from "./browserPageInput";
import type { BrowserToolResult } from "./browserTabHost";

export async function executeBrowserDrag(
  contents: WebContents,
  args: Record<string, unknown>,
  context: BrowserInputContext & {
    expectedDescription: string | null;
    requestApproval(description: string): BrowserToolResult;
  },
): Promise<
  BrowserToolResult | { mode: "pointer" | "html5"; dispatched: true }
> {
  const source = Number(args.backendNodeId),
    target = Number(args.targetBackendNodeId);
  if (!Number.isSafeInteger(target) || target <= 0 || source === target)
    throw new Error(
      "Browser drag requires a different observed destination node",
    );
  return runBrowserInput(
    contents,
    async (command) => {
      const describeTargets = async () => {
        const descriptions = [];
        for (const id of [source, target])
          descriptions.push(
            await withBrowserInputNode(
              contents,
              id,
              command,
              async (objectId) => {
                const response = await command("Runtime.callFunctionOn", {
                  objectId,
                  functionDeclaration: dragNodeDescription.toString(),
                  returnByValue: true,
                });
                const value = response?.result?.value;
                if (response?.exceptionDetails || typeof value !== "string")
                  throw new Error(
                    "Browser drag target is detached, disabled or outside the main document",
                  );
                return value;
              },
            ),
          );
        return createHash("sha256")
          .update(JSON.stringify(descriptions))
          .digest("hex");
      };
      const description = await describeTargets();
      if (context.expectedDescription === null)
        return context.requestApproval(description);
      if (context.expectedDescription !== description)
        throw new Error(
          "Browser approved drag source or destination changed after preflight",
        );
      // Bring both endpoints into view, then read their final coordinates again.
      await browserNodeInputPoint(contents, target, command);
      const from = await browserNodeInputPoint(contents, source, command);
      const to = await browserNodeInputPoint(contents, target, command, false);
      const tree = await command("Page.getFrameTree");
      const frameId = tree?.frameTree?.frame?.id;
      const hit = async (point: { x: number; y: number }) => {
        const metrics = await command("Page.getLayoutMetrics");
        const viewport = metrics?.cssVisualViewport;
        if (
          !Number.isFinite(viewport?.pageX) ||
          !Number.isFinite(viewport?.pageY)
        )
          throw new Error("Browser drag viewport is unavailable");
        const node = await command("DOM.getNodeForLocation", {
          x: Math.floor(point.x + viewport.pageX),
          y: Math.floor(point.y + viewport.pageY),
        });
        if (!frameId || node?.frameId !== frameId)
          throw new Error("Browser drag into a child frame is unavailable");
      };
      await hit(from);
      await hit(to);
      if ((await describeTargets()) !== description)
        throw new Error(
          "Browser approved drag target changed during preparation",
        );
      const assertDestination = async () => {
        const current = await browserNodeInputPoint(
          contents,
          target,
          command,
          false,
        );
        if (Math.abs(current.x - to.x) > 1 || Math.abs(current.y - to.y) > 1)
          throw new Error("Browser drag destination moved; observe again");
        await hit(to);
      };
      return dispatchBrowserDrag(
        contents,
        command,
        context,
        from,
        to,
        hit,
        assertDestination,
      );
    },
    context,
  );
}

async function dispatchBrowserDrag(
  contents: WebContents,
  command: BrowserInputCommand,
  context: BrowserInputContext,
  from: { x: number; y: number },
  to: { x: number; y: number },
  hit: (point: { x: number; y: number }) => Promise<void>,
  assertDestination: () => Promise<void>,
): Promise<{ mode: "pointer" | "html5"; dispatched: true }> {
  let data: Record<string, unknown> | null = null;
  let interceptError: Error | null = null;
  let detached = false,
    enabled = false,
    pressed = false;
  const onDetach = () => {
    detached = true;
  };
  const onMessage = (
    _event: unknown,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) => {
    if (method !== "Input.dragIntercepted" || sessionId) return;
    try {
      data = readDragData(params.data);
    } catch (error) {
      interceptError =
        error instanceof Error ? error : new Error(String(error));
    }
  };
  contents.debugger.on("detach", onDetach);
  contents.debugger.on("message", onMessage);
  try {
    enabled = true;
    await command("Input.setInterceptDrags", { enabled: true });
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...from,
      button: "none",
      buttons: 0,
    });
    pressed = true;
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...from,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 16; step++) {
      const point = {
        x: from.x + ((to.x - from.x) * step) / 16,
        y: from.y + ((to.y - from.y) * step) / 16,
      };
      await hit(point);
      await command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...point,
        button: "left",
        buttons: 1,
      });
      context.assertCurrent();
      if (interceptError) throw interceptError;
      if (data) break;
    }
    if (data) {
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await assertDestination();
        await command("Input.dispatchDragEvent", { type, ...to, data });
      }
    }
    await assertDestination();
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...to,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    pressed = false;
    return { mode: data ? "html5" : "pointer", dispatched: true };
  } finally {
    // Cancellation and interceptor restoration never send a page action into a new debugger attachment.
    const cleanup = async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (detached || !contents.debugger.isAttached()) return;
      try {
        if (params === undefined) await contents.debugger.sendCommand(method);
        else await contents.debugger.sendCommand(method, params);
      } catch {
        if (!detached && contents.debugger.isAttached())
          context.releaseControl();
      }
    };
    try {
      if (pressed) {
        await cleanup("Input.cancelDragging");
        await context
          .runAgentInput(() =>
            cleanup("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: -1,
              y: -1,
              button: "left",
              buttons: 0,
              clickCount: 1,
            }),
          )
          .catch(() => {});
      }
      if (enabled) await cleanup("Input.setInterceptDrags", { enabled: false });
    } finally {
      contents.debugger.removeListener("detach", onDetach);
      contents.debugger.removeListener("message", onMessage);
    }
  }
}

function readDragData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Browser drag data is unavailable");
  const data = value as Record<string, unknown>;
  if (
    data.files !== undefined &&
    (!Array.isArray(data.files) || data.files.length !== 0)
  )
    throw new Error("Browser drag cannot upload local files");
  if (
    !Array.isArray(data.items) ||
    data.items.length > 100 ||
    !Number.isSafeInteger(data.dragOperationsMask) ||
    // Chromium reports the all-operations bitmask as -1.
    Number(data.dragOperationsMask) < -1 ||
    Number(data.dragOperationsMask) > 0xffffffff
  )
    throw new Error("Browser drag data is invalid");
  let size = 0;
  const items = data.items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.mimeType !== "string" ||
      typeof item.data !== "string"
    )
      throw new Error("Browser drag item is invalid");
    size += item.mimeType.length + item.data.length;
    const optional: Record<string, string> = {};
    for (const key of ["baseURL", "title"])
      if (item[key] !== undefined) {
        if (typeof item[key] !== "string")
          throw new Error("Browser drag item is invalid");
        size += item[key].length;
        optional[key] = item[key];
      }
    return { mimeType: item.mimeType, data: item.data, ...optional };
  });
  if (size > 1000000)
    throw new Error("Browser drag data exceeds its supported size");
  return { items, dragOperationsMask: data.dragOperationsMask };
}

function dragNodeDescription(this: Element): string | null {
  if (
    !(this instanceof Element) ||
    this.ownerDocument !== document ||
    !this.isConnected ||
    this.matches(":disabled")
  )
    return null;
  return JSON.stringify({
    tag: this.tagName,
    attributes: Array.from(this.attributes, (a) => [a.name, a.value]),
    text: this.textContent,
  });
}
