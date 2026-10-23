import { describe, expect, it } from "vitest";
import { createBrowserHistoryAccessResponses } from "./browser-history-access-provider.mjs";

describe("History access provider evidence", () => {
  it.each([
    (result) => result,
    (result) => [{ type: "text", text: JSON.stringify(result) }],
    (result) =>
      JSON.stringify({
        contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
      }),
  ])(
    "reads actual history results through typed tool output envelopes",
    (envelope) => {
      const scenario = {};
      const responses = createBrowserHistoryAccessResponses(
        scenario,
        (body) => body,
      );
      scenario.historyAccess.query = "controlled title";
      expect(responses[0]()).toMatchObject({
        name: "browser__history",
        arguments: { query: "controlled title", limit: 5 },
      });
      responses[1]({
        body: envelope({
          status: "completed",
          tab: { tabId: "tab-1" },
          data: { entries: [{ title: "controlled title" }] },
        }),
      });
      expect(scenario.historyAccess.results.allowed).toMatchObject({
        completed: true,
        hasHistory: true,
        hasData: true,
        state: { tabId: "tab-1" },
      });
    },
  );

  it.each([
    null,
    { status: "completed", data: { entries: [] } },
    { error: "history access disabled" },
    { error: "approval declined" },
  ])(
    "does not infer disclosed history from a missing, empty or failed result: %j",
    (body) => {
      const scenario = {};
      const responses = createBrowserHistoryAccessResponses(
        scenario,
        (value) => value,
      );
      scenario.historyAccess.query = "controlled title";
      responses[1]({ body });
      expect(scenario.historyAccess.results.allowed.hasHistory).toBe(false);
      if (body?.error)
        expect(scenario.historyAccess.results.allowed).toMatchObject({
          completed: false,
          hasData: false,
          rejected: true,
        });
    },
  );
});
