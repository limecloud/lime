import { describe, expect, it } from "vitest";

import { mergeInvokeTraceEvidence } from "./invoke-trace.mjs";

describe("claw chat current fixture invoke trace evidence", () => {
  it("keeps the App Server IPC trace after routine drain entries evict it from the live buffer", () => {
    const turnStart = {
      timestamp: "2026-07-19T06:21:21.900Z",
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      duration_ms: 28,
      args_preview: {
        request: {
          lines: [
            JSON.stringify({
              jsonrpc: "2.0",
              id: "turn-start-1",
              method: "turn/start",
              params: { threadId: "thread-1" },
            }),
          ],
        },
      },
    };
    const routineDrain = (timestamp) => ({
      timestamp,
      command: "app_server_drain_events",
      transport: "electron-ipc",
      status: "success",
      duration_ms: 25,
    });

    const evidence = mergeInvokeTraceEvidence(
      [turnStart, routineDrain("2026-07-19T06:21:22.000Z")],
      Array.from({ length: 100 }, (_, index) =>
        routineDrain(`2026-07-19T06:22:${String(index).padStart(2, "0")}Z`),
      ),
      [turnStart],
    );

    expect(evidence).toEqual([turnStart]);
  });

  it("retains failed or non-Electron drain traces for negative assertions", () => {
    const mockDrain = {
      command: "app_server_drain_events",
      transport: "renderer-mock",
      status: "success",
    };
    const failedDrain = {
      command: "app_server_drain_events",
      transport: "electron-ipc",
      status: "error",
    };

    expect(mergeInvokeTraceEvidence([mockDrain, failedDrain])).toEqual([
      mockDrain,
      failedDrain,
    ]);
  });
});
