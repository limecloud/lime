import { describe, expect, it, vi } from "vitest";
import {
  createConversationProjectionStore,
  selectConversationStreamDiagnostics,
  selectLatestConversationStreamDiagnostic,
} from "./conversationProjectionStore";

describe("conversationProjectionStore", () => {
  it("应记录 stream diagnostics，并按 session 提供最新投影", () => {
    const store = createConversationProjectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const first = store.recordStreamDiagnostic({
      phase: "agentStream.request.start",
      at: 10,
      wallTime: 1000,
      sessionId: "session-a",
      workspaceId: "workspace-a",
      source: "test",
      requestId: "request-a",
      actualSessionId: null,
      metrics: {
        route: "home",
      },
    });
    const second = store.recordStreamDiagnostic({
      phase: "agentStream.firstTextDelta",
      at: 20,
      wallTime: 1010,
      sessionId: "session-a",
      workspaceId: "workspace-a",
      source: "test",
      requestId: "request-a",
      actualSessionId: "actual-a",
      metrics: {
        latencyMs: 10,
      },
    });

    const snapshot = store.getSnapshot();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(selectConversationStreamDiagnostics(snapshot)).toEqual([
      first,
      second,
    ]);
    expect(
      selectLatestConversationStreamDiagnostic(snapshot, "session-a"),
    ).toEqual(second);
  });

  it("应只通知 diagnostics 订阅者，未变化的其它 slice 保持引用稳定", () => {
    const store = createConversationProjectionStore();
    const before = store.getSnapshot();

    store.recordStreamDiagnostic({
      phase: "agentStream.firstEvent",
      at: 1,
      wallTime: 1,
      sessionId: "session-b",
      workspaceId: "workspace-b",
      source: "test",
      requestId: "request-b",
      actualSessionId: null,
      metrics: {},
    });

    const after = store.getSnapshot();
    expect(after.diagnostics).not.toBe(before.diagnostics);
    expect(after.session).toBe(before.session);
    expect(after.stream).toBe(before.stream);
    expect(after.queue).toBe(before.queue);
    expect(after.render).toBe(before.render);
  });

  it("无 sessionId 时应按 requestId 记录最新 stream diagnostic", () => {
    const store = createConversationProjectionStore();

    const entry = store.recordStreamDiagnostic({
      phase: "agentStream.submitAccepted",
      at: 1,
      wallTime: 1,
      sessionId: null,
      workspaceId: "workspace-c",
      source: "test",
      requestId: "request-c",
      actualSessionId: null,
      metrics: {},
    });

    expect(
      selectLatestConversationStreamDiagnostic(
        store.getSnapshot(),
        "request-c",
      ),
    ).toEqual(entry);
  });
});
