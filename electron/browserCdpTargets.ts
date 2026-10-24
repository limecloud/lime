import type { BrowserTabPolicy } from "./browserTabPolicy";

export interface BrowserCdpPage {
  tabId: string;
  title: string;
  url: string;
  attached: boolean;
}

export interface BrowserCdpTargets {
  current: () => BrowserCdpPage;
  pages: () => BrowserCdpPage[];
  close: () => void;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const targetId = (page: BrowserCdpPage) => `browser-use-iab-tab:${page.tabId}`;
const pageTarget = (page: BrowserCdpPage) => ({
  attached: true,
  canAccessOpener: false,
  id: targetId(page),
  tabId: page.tabId,
  targetId: targetId(page),
  title: page.title,
  type: "page",
  url: page.url,
});

export function isEmulatedTargetCommand(method: string): boolean {
  return [
    "Target.getTargetInfo",
    "Target.getTargets",
    "Target.closeTarget",
  ].includes(method);
}

export function assertCurrentTarget(
  method: string,
  params: Record<string, unknown>,
  targets: BrowserCdpTargets,
): void {
  if (
    (method === "Target.getTargetInfo" &&
      params.targetId !== undefined &&
      params.targetId !== targetId(targets.current())) ||
    (method === "Target.closeTarget" &&
      params.targetId !== targetId(targets.current()))
  )
    throw new Error(`${method} can only access the current in-app browser tab`);
}

/** Native Target discovery is global; prove ancestry from this WebContents' frame tree. */
export async function getDebuggerFrameTargetInfos(context: {
  targets: BrowserCdpTargets;
  policy: BrowserTabPolicy;
  assertActive: () => void;
  sendDebuggerCommand: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}): Promise<Record<string, unknown>[]> {
  const tree = record(
    await context.sendDebuggerCommand("Page.getFrameTree", {}),
  );
  context.assertActive();
  const frames = new Map<string, string>();
  const visit = (value: unknown) => {
    const node = record(value);
    const frame = record(node?.frame);
    if (!frame || typeof frame.id !== "string" || typeof frame.url !== "string")
      throw new Error("Browser CDP frame tree is unavailable");
    frames.set(frame.id, frame.url);
    if (node?.childFrames !== undefined) {
      if (!Array.isArray(node.childFrames))
        throw new Error("Browser CDP frame tree is invalid");
      for (const child of node.childFrames) visit(child);
    }
  };
  visit(tree?.frameTree);
  const result = record(
    await context.sendDebuggerCommand("Target.getTargets", {}),
  );
  context.assertActive();
  if (!Array.isArray(result?.targetInfos))
    throw new Error("Browser CDP target list is unavailable");
  const candidates = result.targetInfos.flatMap((value: unknown) => {
    const info = record(value);
    if (!info || (info.type !== "iframe" && info.type !== "other")) return [];
    const id = info.targetId ?? info.id;
    if (typeof id !== "string" || typeof info.url !== "string") return [];
    return [{ info, id, url: info.url }];
  });
  // Page.getFrameTree omits out-of-process children. Their native Target
  // parentFrameId links must reach a known frame; URL equality alone is unsafe.
  for (let remaining = candidates.length; remaining > 0; remaining -= 1) {
    let added = false;
    for (const { info, id, url } of candidates) {
      if (
        !frames.has(id) &&
        typeof info.parentFrameId === "string" &&
        frames.has(info.parentFrameId)
      ) {
        frames.set(id, url);
        added = true;
      }
    }
    if (!added) break;
  }
  return candidates.flatMap(({ info, id, url }) => {
    if (frames.get(id) !== url) return [];
    if (
      context.policy.decision("browse", url) === "deny" ||
      !context.policy.allows("debug", url)
    )
      return [];
    return [{ ...info, tabId: context.targets.current().tabId }];
  });
}

/** Mirrors Codex's logical page Target adapter; close is finalized by the caller after policy refresh. */
export async function executeEmulatedTargetCommand(
  method: string,
  context: Parameters<typeof getDebuggerFrameTargetInfos>[0],
): Promise<unknown> {
  if (method === "Target.getTargetInfo") {
    const page = context.targets.current();
    return { targetInfo: { ...pageTarget(page), attached: page.attached } };
  }
  if (method === "Target.getTargets") {
    const frames = await getDebuggerFrameTargetInfos(context);
    return {
      targetInfos: [...context.targets.pages().map(pageTarget), ...frames],
    };
  }
  if (method === "Target.closeTarget") return { success: true };
  throw new Error(
    `Browser Use CDP method is not supported in the in-app browser: ${method}`,
  );
}
