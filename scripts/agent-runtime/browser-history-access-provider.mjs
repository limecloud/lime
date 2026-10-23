export const HISTORY_ACCESS_CASES = [
  { name: "allowed", access: "neverAsk", approved: true },
  {
    name: "approved",
    access: "alwaysAsk",
    decision: "allow_once",
    approved: true,
  },
  {
    name: "declined",
    access: "alwaysAsk",
    decision: "decline",
    approved: false,
  },
  { name: "disabled", access: "disabled", approved: false },
  {
    name: "policy-revoked",
    access: "alwaysAsk",
    decision: "allow_once",
    approved: false,
  },
  {
    name: "revoked",
    access: "alwaysAsk",
    decision: "allow_once",
    approved: false,
  },
];

function completedHistoryResult(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === "string") {
    try {
      return completedHistoryResult(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  if (value.status === "completed" && Array.isArray(value.data?.entries))
    return value;
  for (const child of Object.values(value)) {
    const result = completedHistoryResult(child, depth + 1);
    if (result) return result;
  }
  return null;
}

/** Only the local scripted provider consumes tool outputs; no history is injected. */
export function createBrowserHistoryAccessResponses(
  scenario,
  toolResultFromRequest,
) {
  scenario.historyAccess = { query: null, results: {} };
  return HISTORY_ACCESS_CASES.flatMap((entry) => [
    () => {
      if (!scenario.historyAccess.query)
        throw new Error("History query is not initialized");
      return {
        type: "tool_call",
        id: `history-access-${entry.name}`,
        name: "browser__history",
        arguments: { query: scenario.historyAccess.query, limit: 5 },
      };
    },
    ({ body }) => {
      const raw = toolResultFromRequest(body);
      const result = completedHistoryResult(raw);
      const entries = result?.data?.entries;
      scenario.historyAccess.results[entry.name] = {
        completed: result?.status === "completed",
        hasHistory:
          Array.isArray(entries) &&
          entries.some((item) => item.title === scenario.historyAccess.query),
        hasData: result?.data !== undefined,
        rejected: /disabled|declin|拒绝|stale|unavailable|revoked/i.test(
          JSON.stringify(raw),
        ),
        state: result?.tab ?? null,
      };
      return { type: "text", content: `HISTORY_ACCESS_DONE_${entry.name}` };
    },
  ]);
}
