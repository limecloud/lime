import { describe, expect, it } from "vitest";
import {
  isAsterSessionNotFoundError,
  resolveRestorableSessionId,
  sortSessionsByRecency,
} from "./asterSessionRecovery";

describe("asterSessionRecovery", () => {
  it("优先返回候选会话", () => {
    const sessionId = resolveRestorableSessionId({
      candidateSessionId: "session-b",
      sessions: [
        { id: "session-a", updatedAt: 2 },
        { id: "session-b", updatedAt: 1 },
      ],
    });

    expect(sessionId).toBe("session-b");
  });

  it("候选为空白时回退到最近会话", () => {
    const sessionId = resolveRestorableSessionId({
      candidateSessionId: "   ",
      sessions: [
        { id: "session-a", updatedAt: 100 },
        { id: "session-b", updatedAt: 200 },
      ],
    });

    expect(sessionId).toBe("session-b");
  });

  it("候选失效时回退到最近会话", () => {
    const sessionId = resolveRestorableSessionId({
      candidateSessionId: "session-missing",
      sessions: [
        { id: "session-a", updatedAt: 100 },
        { id: "session-b", updatedAt: 200 },
      ],
    });

    expect(sessionId).toBe("session-b");
  });

  it("缺少更新时间时按创建时间排序", () => {
    const sorted = sortSessionsByRecency([
      { id: "session-a", createdAt: 100 },
      { id: "session-b", createdAt: 300 },
      { id: "session-c", createdAt: 200 },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "session-b",
      "session-c",
      "session-a",
    ]);
  });

  it("按更新时间降序排序", () => {
    const sorted = sortSessionsByRecency([
      { id: "session-a", updatedAt: 100 },
      { id: "session-b", updatedAt: 300 },
      { id: "session-c", updatedAt: 200 },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "session-b",
      "session-c",
      "session-a",
    ]);
  });

  it("没有可恢复会话时返回 null", () => {
    const sessionId = resolveRestorableSessionId({
      candidateSessionId: "session-missing",
      sessions: [],
    });

    expect(sessionId).toBeNull();
  });

  it("识别会话不存在错误", () => {
    expect(isAsterSessionNotFoundError("会话不存在: abc")).toBe(true);
    expect(
      isAsterSessionNotFoundError(new Error("Session not found: abc")),
    ).toBe(true);
    expect(isAsterSessionNotFoundError("network error")).toBe(false);
  });
});
