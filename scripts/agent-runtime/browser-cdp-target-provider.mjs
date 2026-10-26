import { assert } from "../lib/chat-fixture/utils.mjs";
import {
  completedBrowserCdpResult as completed,
  createBrowserCdpSessionResponses,
} from "./browser-cdp-session-provider.mjs";

export const CDP_TARGET_CASES = [
  { name: "target-info", method: "Target.getTargetInfo" },
  { name: "target-list", method: "Target.getTargets" },
  { name: "frame-session", method: "Target.attachToTarget" },
  { name: "target-close", method: "Target.closeTarget" },
];

export function createBrowserCdpTargetResponses(scenario, helpers) {
  const { extractBrowserState, toolResultFromRequest } = helpers;
  scenario.cdp.targets = { claimed: {}, results: {} };
  return CDP_TARGET_CASES.flatMap((entry) =>
    entry.name === "frame-session"
      ? createBrowserCdpSessionResponses(scenario, helpers)
      : [
          {
            type: "tool_call",
            id: `${entry.name}-tabs`,
            name: "browser__openTabs",
            arguments: {},
          },
          ({ body }) => {
            const tab = extractBrowserState(toolResultFromRequest(body));
            assert(tab?.tabId, "Target fixture did not receive a live tab");
            return {
              type: "tool_call",
              id: `${entry.name}-claim`,
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
              "Target fixture did not claim the live turn",
            );
            scenario.cdp.targets.claimed[entry.name] = tab;
            return {
              type: "tool_call",
              id: `${entry.name}-execute`,
              name: "browser__executeCdpCommand",
              arguments: {
                tabId: tab.tabId,
                method: entry.method,
                commandParams:
                  entry.method === "Target.closeTarget"
                    ? { targetId: `browser-use-iab-tab:${tab.tabId}` }
                    : {},
              },
            };
          },
          ({ body }) => {
            const result = completed(toolResultFromRequest(body));
            scenario.cdp.targets.results[entry.name] = {
              success: Boolean(result),
              data: result?.data ?? null,
              tab: result?.tab ?? null,
            };
            return { type: "text", content: `BROWSER_CDP_DONE_${entry.name}` };
          },
        ],
  );
}
