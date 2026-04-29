import { afterEach, describe, expect, it } from "vitest";

import { loadPersisted, loadTransient } from "./agentChatStorage";

afterEach(() => {
  sessionStorage.clear();
});

describe("agentChatStorage", () => {
  it("读取超大的会话临时态时应直接丢弃，避免同步 JSON parse 卡住会话切换", () => {
    const key = "aster_thread_items_workspace-1";
    sessionStorage.setItem(key, `"${"x".repeat(1_500_001)}"`);

    expect(loadTransient(key, ["fallback"])).toEqual(["fallback"]);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("读取超大的会话快照 map 时应直接丢弃，避免点击旧对话时解析历史大缓存", () => {
    const key = "aster_session_snapshots_workspace-1";
    sessionStorage.setItem(key, `{"topic-heavy":"${"x".repeat(1_500_001)}"}`);

    expect(loadTransient(key, { fallback: true })).toEqual({ fallback: true });
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("读取超大的持久化会话快照 map 时应直接丢弃，避免 localStorage 解析阻塞", () => {
    const key = "aster_session_snapshots_persisted_workspace-1";
    localStorage.setItem(key, `{"topic-heavy":"${"x".repeat(1_500_001)}"}`);

    expect(loadPersisted(key, { fallback: true })).toEqual({
      fallback: true,
    });
    expect(localStorage.getItem(key)).toBeNull();
  });
});
