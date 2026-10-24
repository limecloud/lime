import { assert } from "./claw-chat-current-fixture-utils.mjs";

export function completedBrowserCdpResult(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === "string") {
    try {
      return completedBrowserCdpResult(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  if (value.status === "completed" && value.data) return value;
  for (const child of Object.values(value)) {
    const result = completedBrowserCdpResult(child, depth + 1);
    if (result) return result;
  }
  return null;
}

/** Scripted model only: every result is supplied by the real runtime tool owner. */
export function createBrowserCdpSessionResponses(scenario, helpers) {
  const { extractBrowserState, toolResultFromRequest } = helpers;
  const state = (scenario.cdp.sessions = { results: {} });
  const request = (step, tool, args) => ({
    type: "tool_call",
    id: `frame-session-${step}`,
    name: `browser__${tool}`,
    arguments: { tabId: state.claimed?.tabId, ...args },
  });
  const record = (step, body) => {
    const raw = toolResultFromRequest(body);
    const result = completedBrowserCdpResult(raw);
    state.results[step] = {
      success: Boolean(result),
      data: result?.data ?? null,
    };
    return { raw, result };
  };
  return [
    {
      type: "tool_call",
      id: "frame-session-tabs",
      name: "browser__openTabs",
      arguments: {},
    },
    ({ body }) => {
      const tab = extractBrowserState(toolResultFromRequest(body));
      assert(tab?.tabId, "Frame session fixture did not receive a live tab");
      return request("claim", "claimTab", {
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        pageRevision: tab.pageRevision,
      });
    },
    ({ body }) => {
      const tab = extractBrowserState(toolResultFromRequest(body));
      assert(
        tab?.activeTurnId && tab.controlOwner === "agent",
        "Frame session fixture did not claim the live turn",
      );
      state.claimed = tab;
      return request("list", "executeCdpCommand", {
        method: "Target.getTargets",
        commandParams: {},
      });
    },
    ({ body }) => {
      const { result } = record("list", body);
      const frame = result?.data.targetInfos?.find(
        (target) =>
          target.type === "iframe" && new URL(target.url).pathname === "/frame",
      );
      assert(
        frame?.targetId,
        "Frame session fixture did not discover its native child",
      );
      state.targetId = frame.targetId;
      return request("attach", "attachTarget", { targetId: frame.targetId });
    },
    ({ body }) => {
      const { result } = record("attach", body);
      assert(
        result?.data.sessionId && result.data.targetId === state.targetId,
        "Frame session fixture did not receive a native session",
      );
      state.sessionId = result.data.sessionId;
      return request("mutate", "executeCdpCommand", {
        method: "Runtime.evaluate",
        target: { targetId: state.targetId },
        commandParams: {
          expression:
            "document.documentElement.dataset.cdpSessionMutations = String(Number(document.documentElement.dataset.cdpSessionMutations || '0') + 1); Number(document.documentElement.dataset.cdpSessionMutations)",
          returnByValue: true,
        },
      });
    },
    ({ body }) => {
      record("mutate", body);
      return request("read", "executeCdpCommand", {
        method: "Runtime.evaluate",
        target: { sessionId: state.sessionId },
        commandParams: {
          expression:
            "Number(document.documentElement.dataset.cdpSessionMutations || '0')",
          returnByValue: true,
        },
      });
    },
    ({ body }) => {
      record("read", body);
      return request("detach", "detachTarget", { targetId: state.targetId });
    },
    ({ body }) => {
      record("detach", body);
      return request("stale", "executeCdpCommand", {
        method: "Runtime.evaluate",
        target: { sessionId: state.sessionId },
        commandParams: {
          expression:
            "document.documentElement.dataset.cdpSessionMutations = '999'",
          returnByValue: true,
        },
      });
    },
    ({ body }) => {
      const { raw } = record("stale", body);
      state.results.stale.rejected = /session|attached|stale|denied/iu.test(
        JSON.stringify(raw),
      );
      return { type: "text", content: "BROWSER_CDP_DONE_frame-session" };
    },
  ];
}
