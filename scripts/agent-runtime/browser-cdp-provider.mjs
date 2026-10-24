import { assert } from "./claw-chat-current-fixture-utils.mjs";

export const CDP_CASES = [
  { name: "approved", enabled: true, decision: "allow_once", success: true },
  { name: "declined", enabled: true, decision: "decline", success: false },
  { name: "disabled", enabled: false, success: false },
  { name: "revoked", enabled: true, decision: "allow_once", success: false },
  { name: "reenabled", enabled: true, decision: "allow_once", success: true },
];

function completedCommand(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === "string") {
    try {
      return completedCommand(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  if (value.status === "completed" && value.data?.result) return value;
  for (const child of Object.values(value)) {
    const found = completedCommand(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The scripted model requests a real tool; it never supplies a native result. */
export function createBrowserCdpResponses(scenario, helpers) {
  const { extractBrowserState, toolResultFromRequest } = helpers;
  scenario.cdp = { claimed: {}, results: {} };
  return CDP_CASES.flatMap((entry) => [
    {
      type: "tool_call",
      id: `cdp-${entry.name}-tabs`,
      name: "browser__openTabs",
      arguments: {},
    },
    ({ body }) => {
      const tab = extractBrowserState(toolResultFromRequest(body));
      assert(tab?.tabId, "CDP fixture did not receive a native tab");
      return {
        type: "tool_call",
        id: `cdp-${entry.name}-claim`,
        name: "browser__claimTab",
        arguments: {
          tabId: tab.tabId,
          title: tab.title,
          url: tab.url,
          pageRevision: tab.pageRevision,
        },
      };
    },
    ({ body }) => {
      const tab = extractBrowserState(toolResultFromRequest(body));
      assert(
        tab?.activeTurnId && tab.controlOwner === "agent",
        "CDP fixture did not claim the live turn",
      );
      scenario.cdp.claimed[entry.name] = tab;
      return {
        type: "tool_call",
        id: `cdp-${entry.name}-execute`,
        name: "browser__executeCdpCommand",
        arguments: {
          tabId: tab.tabId,
          method: "Runtime.evaluate",
          commandParams: {
            expression:
              "document.getElementById('browser-approval-target').click(); Number(document.documentElement.dataset.browserApprovalMutationCount)",
            returnByValue: true,
          },
        },
      };
    },
    ({ body }) => {
      const raw = toolResultFromRequest(body);
      const completed = completedCommand(raw);
      scenario.cdp.results[entry.name] = {
        success: completed?.status === "completed",
        value: completed?.data?.result?.value ?? null,
        tab: completed?.tab ?? null,
        rejected: /denied|declin|拒绝|stale|invalid|mismatch|revoked/i.test(
          JSON.stringify(raw),
        ),
      };
      return { type: "text", content: `BROWSER_CDP_DONE_${entry.name}` };
    },
  ]);
}
