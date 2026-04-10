import { describe, expect, it } from "vitest";
import type { TeamWorkspaceLiveRuntimeState } from "../teamWorkspaceRuntime";
import {
  collectInactiveSessionIds,
  pruneInactiveSessionRecord,
  reconcileActiveLiveRuntimeBySessionId,
} from "./runtimeStateReconciler";

describe("runtimeStateReconciler", () => {
  it("应收集 inactive session 并裁剪通用 session record", () => {
    const activeSessionIds = new Set(["child-1"]);
    const record = {
      "child-1": { value: 1 },
      "child-2": { value: 2 },
    };

    expect(collectInactiveSessionIds(record, activeSessionIds)).toEqual([
      "child-2",
    ]);
    expect(pruneInactiveSessionRecord(record, activeSessionIds)).toEqual({
      "child-1": { value: 1 },
    });
  });

  it("应在 baseFingerprint 追平时仅重置 liveRuntime，而不误删仍活跃 session", () => {
    const activeSessionIds = new Set(["child-1", "child-2"]);
    const liveRuntimeBySessionId: Record<string, TeamWorkspaceLiveRuntimeState> = {
      "child-1": {
        runtimeStatus: "running",
        latestTurnStatus: "running",
        baseFingerprint: "fp-old",
      },
      "child-2": {
        runtimeStatus: "queued",
        latestTurnStatus: "queued",
        baseFingerprint: "fp-2",
      },
    };
    const baseFingerprintById = new Map([
      ["child-1", "fp-new"],
      ["child-2", "fp-2"],
    ]);

    expect(
      reconcileActiveLiveRuntimeBySessionId(
        liveRuntimeBySessionId,
        activeSessionIds,
        baseFingerprintById,
      ),
    ).toEqual({
      "child-2": {
        runtimeStatus: "queued",
        latestTurnStatus: "queued",
        baseFingerprint: "fp-2",
      },
    });
  });
});
