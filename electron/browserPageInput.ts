/// <reference lib="dom" />
import type { WebContents } from "electron";

export type BrowserPointerAction = "hover" | "scroll";
export type BrowserInputCommand = (
  method: string,
  params?: Record<string, unknown>,
) => ReturnType<WebContents["debugger"]["sendCommand"]>;
export interface BrowserInputContext {
  onStart?(): void;
  assertCurrent(): void;
  runAgentInput<T>(action: () => Promise<T>): Promise<T>;
  releaseControl(): void;
}
const activeBrowserInputs = new WeakSet<WebContents>();

/** Snapshot and permission authority stay in BrowserTabHost. */
export async function executeBrowserPointerAction(
  contents: WebContents,
  action: BrowserPointerAction,
  args: Record<string, unknown>,
  context: BrowserInputContext,
): Promise<void> {
  return runBrowserInput(
    contents,
    (command) => runBrowserPointerAction(contents, action, args, command),
    context,
  );
}

export async function runBrowserInput<T>(
  contents: WebContents,
  action: (command: BrowserInputCommand) => Promise<T>,
  context: BrowserInputContext,
): Promise<T> {
  if (activeBrowserInputs.has(contents))
    throw new Error("Browser native input is already in progress");
  activeBrowserInputs.add(contents);
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => {
    if (expired) throw new Error("Browser pointer action expired");
    context.assertCurrent();
  };
  const command: BrowserInputCommand = async (method, params) => {
    active();
    const result = method.startsWith("Input.")
      ? await context.runAgentInput(() =>
          contents.debugger.sendCommand(method, params),
        )
      : await contents.debugger.sendCommand(method, params);
    active();
    return result;
  };
  try {
    context.onStart?.();
    return await Promise.race([
      action(command),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          const error = new Error("Browser pointer action timed out");
          try {
            context.releaseControl();
          } catch (cause) {
            error.cause = cause;
          }
          reject(error);
        }, 10000);
      }),
    ]);
  } finally {
    activeBrowserInputs.delete(contents);
    expired = true;
    if (timer) clearTimeout(timer);
  }
}

async function runBrowserPointerAction(
  contents: WebContents,
  action: BrowserPointerAction,
  args: Record<string, unknown>,
  command: BrowserInputCommand,
): Promise<void> {
  const backendNodeId = args.backendNodeId;
  if (
    (action === "hover" || backendNodeId !== undefined) &&
    (!Number.isSafeInteger(backendNodeId) || Number(backendNodeId) <= 0)
  )
    throw new Error("Browser input requires a valid observed backendNodeId");
  const deltaX = readDelta(args.deltaX, "deltaX");
  const deltaY = readDelta(args.deltaY, "deltaY");
  if (action === "scroll" && deltaX === 0 && deltaY === 0)
    throw new Error("Browser scroll requires a non-zero delta");

  const tree = await command("Page.getFrameTree");
  const frameId = tree?.frameTree?.frame?.id;
  if (typeof frameId !== "string" || !frameId)
    throw new Error("Browser main frame is unavailable");
  let point: { x: number; y: number };
  if (backendNodeId !== undefined) {
    point = await browserNodeInputPoint(
      contents,
      Number(backendNodeId),
      command,
    );
  }
  const metrics = await command("Page.getLayoutMetrics");
  const viewport = metrics?.cssVisualViewport;
  if (
    !Number.isFinite(viewport?.clientWidth) ||
    !Number.isFinite(viewport?.clientHeight) ||
    !Number.isFinite(viewport?.pageX) ||
    !Number.isFinite(viewport?.pageY) ||
    viewport.clientWidth <= 0 ||
    viewport.clientHeight <= 0
  )
    throw new Error("Browser viewport is unavailable");
  point ??= { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
  // DOM hit testing uses document CSS pixels; native input uses viewport CSS pixels.
  const hit = await command("DOM.getNodeForLocation", {
    x: Math.floor(point.x + viewport.pageX),
    y: Math.floor(point.y + viewport.pageY),
  });
  if (hit?.frameId !== frameId)
    throw new Error("Browser pointer input into a child frame is unavailable");
  await command("Input.dispatchMouseEvent", {
    type: action === "hover" ? "mouseMoved" : "mouseWheel",
    ...point,
    ...(action === "scroll" ? { deltaX, deltaY } : {}),
    button: "none",
    buttons: 0,
  });
}

export async function withBrowserInputNode<T>(
  contents: WebContents,
  backendNodeId: number,
  command: BrowserInputCommand,
  action: (objectId: string) => Promise<T>,
): Promise<T> {
  const tree = await command("Page.getFrameTree");
  const frameId = tree?.frameTree?.frame?.id;
  if (typeof frameId !== "string" || !frameId)
    throw new Error("Browser main frame is unavailable");
  const world = await command("Page.createIsolatedWorld", {
    frameId,
    worldName: "browser-input",
  });
  if (!Number.isSafeInteger(world?.executionContextId))
    throw new Error("Browser input context is unavailable");
  const resolved = await command("DOM.resolveNode", {
    backendNodeId,
    executionContextId: world.executionContextId,
  });
  const objectId = resolved?.object?.objectId;
  if (typeof objectId !== "string" || !objectId)
    throw new Error("Browser input target is unavailable");
  try {
    return await action(objectId);
  } finally {
    await contents.debugger
      .sendCommand("Runtime.releaseObject", { objectId })
      .catch(() => {});
  }
}

export async function browserNodeInputPoint(
  contents: WebContents,
  backendNodeId: number,
  command: BrowserInputCommand,
  scroll = true,
): Promise<{ x: number; y: number }> {
  return withBrowserInputNode(
    contents,
    backendNodeId,
    command,
    async (objectId) => {
      const response = await command("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: browserInputPoint.toString(),
        arguments: [{ value: scroll }],
        returnByValue: true,
        awaitPromise: true,
      });
      const value = response?.result?.value;
      if (response?.exceptionDetails || typeof value?.error === "string")
        throw new Error(value?.error ?? "Browser input target is unavailable");
      if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y))
        throw new Error("Browser input target did not return a visible point");
      return { x: value.x, y: value.y };
    },
  );
}

function readDelta(value: unknown, name: string): number {
  if (value === undefined) return 0;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 10000
  )
    throw new Error(`Browser scroll ${name} must be between -10000 and 10000`);
  return value;
}

/** Runs in an isolated world; never exposes a page capability or synthesizes events. */
async function browserInputPoint(
  this: Element,
  scroll: boolean,
): Promise<{ x: number; y: number } | { error: string }> {
  if (
    !(this instanceof Element) ||
    !this.isConnected ||
    this.ownerDocument !== document
  )
    return {
      error: "Browser input target is detached or outside the main document",
    };
  const style = getComputedStyle(this);
  if (
    style.visibility !== "visible" ||
    style.display === "none" ||
    this.getClientRects().length === 0
  )
    return { error: "Browser input target is not visible" };
  if (scroll)
    this.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  // Native hit testing must see the committed scroll, not the previous frame.
  const painted = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 1000);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve(true);
      }),
    );
  });
  if (!painted) return { error: "Browser input viewport did not become ready" };
  if (!this.isConnected || this.ownerDocument !== document)
    return { error: "Browser input target changed during scrolling" };
  const rect = this.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const right = Math.min(innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top)
    return { error: "Browser input target has no visible area" };
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  for (let node: Node | null = hit; node; ) {
    if (node === this) return { x, y };
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return {
    error: "Browser input target is obscured or cannot receive pointer events",
  };
}
