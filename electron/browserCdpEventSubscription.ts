import { app } from "./electronRuntime";
import { browserNativePipeClientPath } from "./browserNativePipeResources";
import { getDebuggerFrameTargetInfos } from "./browserCdpTargets";
import type { BrowserCdpSessions } from "./browserCdpSessions";
import type { BrowserCdpEvents } from "./browserCdpEvents";
import type { BrowserTabPolicy } from "./browserTabPolicy";
import type { BrowserTabState } from "./browserTabHost";

export async function subscribeCdpEvents(context: {
  sessions: BrowserCdpSessions;
  events: BrowserCdpEvents;
  policy: BrowserTabPolicy;
  state: () => BrowserTabState;
  assertActive: () => void;
  assertBrowseAllowed: (url: string) => void;
  refreshSettings: () => Promise<void>;
  onDisconnected: () => void;
}) {
  const clientModulePath = browserNativePipeClientPath();
  const initial = context.state();
  const assertAttachment = context.sessions.debuggerAttachmentGuard(
    initial.tabId,
  );
  const assertNativeScope = () => {
    assertAttachment();
    const state = context.state();
    if (
      state.navigationRevision !== initial.navigationRevision ||
      state.viewId !== initial.viewId ||
      state.webContentsId !== initial.webContentsId
    )
      throw new Error("Browser event subscription attachment is stale");
  };
  const assertCurrent = () => {
    context.assertActive();
    assertNativeScope();
  };
  const allows = (url: string) => {
    try {
      context.assertBrowseAllowed(url);
      return context.policy.allows("debug", url);
    } catch {
      return false;
    }
  };
  const send = (method: string, params: Record<string, unknown>) =>
    context.sessions.sendDebuggerCommand(initial.tabId, method, params);
  const connection = await context.events.subscribe({
    tabId: initial.tabId,
    tempDirectory: app.getPath("temp"),
    sessions: context.sessions,
    assertCurrent,
    allows,
    readFrameTree: async () => {
      await context.refreshSettings();
      assertCurrent();
      return send("Page.getFrameTree", {});
    },
    sourceUrl: async (event) => {
      if (!event.source.sessionId) return context.state().url;
      let selected;
      try {
        selected = context.sessions.resolveTarget(initial.tabId, event.source);
      } catch {
        return null;
      }
      const frames = await getDebuggerFrameTargetInfos({
        policy: context.policy,
        assertActive: assertCurrent,
        targets: {
          current: () => ({ ...context.state(), attached: true }),
          pages: () => [],
          close: () => undefined,
        },
        sendDebuggerCommand: send,
      });
      let current;
      try {
        current = context.sessions.resolveTarget(initial.tabId, event.source);
      } catch {
        return null;
      }
      if (current.sessionId !== selected.sessionId) return null;
      const frame = frames.find(
        (frame) => (frame.targetId ?? frame.id) === current.targetId,
      );
      return typeof frame?.url === "string" && allows(frame.url)
        ? frame.url
        : null;
    },
    onDisconnected: () => {
      // Cleanup of an older capability cannot detach a replacement attachment.
      try {
        assertNativeScope();
        context.onDisconnected();
      } catch {
        /* Already revoked. */
      }
    },
  });
  return { ...connection, clientModulePath, source: { tabId: initial.tabId } };
}
