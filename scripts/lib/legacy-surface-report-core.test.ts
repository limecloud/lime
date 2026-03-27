import { describe, expect, it } from "vitest";

import { toSerializableLegacySurfaceReport } from "./legacy-surface-report-core.mjs";

describe("legacy-surface-report-core", () => {
  it("应把命令引用 Map 序列化成普通对象", () => {
    const serialized = toSerializableLegacySurfaceReport({
      repoRoot: "/tmp/lime",
      runtimeSources: [{ relativePath: "src/foo.ts" }],
      testSources: [{ relativePath: "src/foo.test.ts" }],
      rustRuntimeSources: [{ relativePath: "src-tauri/src/lib.rs" }],
      rustTestSources: [],
      importResults: [],
      commandResults: [
        {
          id: "agent-runtime",
          classification: "current",
          description: "runtime command",
          commands: ["agent_runtime_submit_turn"],
          allowedPaths: ["src/lib/api/agentRuntime.ts"],
          referencesByCommand: new Map([
            ["agent_runtime_submit_turn", ["src/lib/api/agentRuntime.ts"]],
          ]),
          testReferencesByCommand: new Map([
            ["agent_runtime_submit_turn", ["src/lib/api/agentRuntime.test.ts"]],
          ]),
          violations: [],
        },
      ],
      frontendTextResults: [],
      rustTextResults: [],
      rustTextCountResults: [],
      zeroReferenceCandidates: [],
      classificationDriftCandidates: [],
      violations: [],
    });

    expect(serialized.summary.runtimeSourceCount).toBe(1);
    expect(serialized.commandResults[0].referencesByCommand).toEqual({
      agent_runtime_submit_turn: ["src/lib/api/agentRuntime.ts"],
    });
    expect(serialized.commandResults[0].testReferencesByCommand).toEqual({
      agent_runtime_submit_turn: ["src/lib/api/agentRuntime.test.ts"],
    });
  });
});
