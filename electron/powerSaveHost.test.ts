import { describe, expect, it, vi } from "vitest";
import { PowerSaveHost } from "./powerSaveHost";

function fixture(platform = "darwin") {
  const start = vi.fn(() => 7);
  const stop = vi.fn();
  const host = new PowerSaveHost({ platform, start, stop });
  const status = (threadId: string, type: string) =>
    host.observeServerMessage({
      method: "thread/status/changed",
      params: { threadId, status: { type, activeFlags: [] } },
    });
  return { host, start, stop, status };
}

describe("PowerSaveHost", () => {
  it.each(["darwin", "linux"])(
    "%s acquires only while enabled with active threads",
    (platform) => {
      const { host, start, stop, status } = fixture(platform);
      status("a", "active");
      expect(start).not.toHaveBeenCalled();
      host.setPreventSleepWhileRunning(true);
      expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
      status("a", "active");
      status("b", "active");
      status("a", "idle");
      expect(stop).not.toHaveBeenCalled();
      status("b", "idle");
      expect(stop).toHaveBeenCalledExactlyOnceWith(7);
      status("b", "idle");
      expect(start).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
    },
  );

  it("Windows never acquires even with persisted preference and activity", () => {
    const { host, start, stop, status } = fixture("win32");
    host.setPreventSleepWhileRunning(true);
    status("a", "active");
    host.dispose();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it.each(["idle", "systemError", "notLoaded"])(
    "canonical %s releases the last active thread",
    (type) => {
      const { host, status, stop } = fixture();
      host.setPreventSleepWhileRunning(true);
      status("a", "active");
      status("a", type);
      expect(stop).toHaveBeenCalledExactlyOnceWith(7);
    },
  );

  it("preference changes release immediately and re-enable still-active work", () => {
    const { host, status, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    status("a", "active");
    host.setPreventSleepWhileRunning(false);
    expect(stop).toHaveBeenCalledExactlyOnceWith(7);
    host.setPreventSleepWhileRunning(true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("cold resume seeds activity while later stale read results cannot override notifications", () => {
    const { host, status, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    host.observeResult("thread/resume", {
      thread: { id: "a", status: { type: "active" } },
    });
    expect(start).toHaveBeenCalledOnce();
    status("a", "idle");
    host.observeResult("thread/read", {
      thread: { id: "a", status: { type: "active" } },
    });
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    status("a", "active");
    host.observeResult("thread/read", {
      thread: { id: "a", status: { type: "idle" } },
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("thread close and connection loss release resources; a new connection can seed its own activity", () => {
    const { host, status, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    status("a", "active");
    host.observeServerMessage({
      method: "thread/closed",
      params: { threadId: "a" },
    });
    expect(stop).toHaveBeenCalledTimes(1);
    status("b", "active");
    host.connectionLost();
    expect(stop).toHaveBeenCalledTimes(2);
    host.observeResult("thread/resume", {
      thread: { id: "a", status: { type: "active" } },
    });
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("shutdown cannot be reversed by late notifications, reads or preference changes", () => {
    const { host, status, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    status("a", "active");
    host.dispose();
    status("b", "active");
    host.observeResult("thread/resume", {
      thread: { id: "a", status: { type: "active" } },
    });
    host.setPreventSleepWhileRunning(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("native failures propagate and a later update can retry without losing the handle", () => {
    const { host, status, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    start.mockImplementationOnce(() => {
      throw new Error("native start failed");
    });
    expect(() => status("a", "active")).toThrow("native start failed");
    status("a", "active");
    stop.mockImplementationOnce(() => {
      throw new Error("native stop failed");
    });
    expect(() => host.setPreventSleepWhileRunning(false)).toThrow(
      "native stop failed",
    );
    host.setPreventSleepWhileRunning(false);
    expect(stop.mock.calls).toEqual([[7], [7]]);
  });

  it.each(["completed", "failed", "interrupted"])(
    "a turn/start acknowledgement acquires without a started notification and %s releases it",
    (status) => {
      const { host, start, stop } = fixture();
      host.setPreventSleepWhileRunning(true);
      host.observeResult(
        "turn/start",
        { turn: { id: "t", status: "inProgress" } },
        { threadId: "a" },
      );
      expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
      host.observeServerMessage({
        method: "turn/completed",
        params: { threadId: "a", turn: { id: "t", status } },
      });
      expect(stop).toHaveBeenCalledExactlyOnceWith(7);
      host.observeResult(
        "turn/start",
        { turn: { id: "t", status: "inProgress" } },
        { threadId: "a" },
      );
      host.observeServerMessage({
        method: "turn/started",
        params: { threadId: "a", turn: { id: "t", status: "inProgress" } },
      });
      host.observeResult("thread/read", {
        thread: { id: "a", status: { type: "active" } },
      });
      expect(start).toHaveBeenCalledTimes(1);
    },
  );

  it("completion arriving before the start acknowledgement cannot resurrect activity", () => {
    const { host, start } = fixture();
    host.setPreventSleepWhileRunning(true);
    host.observeServerMessage({
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "t", status: "completed" } },
    });
    host.observeResult(
      "turn/start",
      { turn: { id: "t", status: "inProgress" } },
      { threadId: "a" },
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("a stale terminal turn cannot release a newer turn or another active thread", () => {
    const { host, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    for (const [threadId, id] of [
      ["a", "old"],
      ["a", "new"],
      ["b", "other"],
    ])
      host.observeResult(
        "turn/start",
        { turn: { id, status: "inProgress" } },
        { threadId },
      );
    for (const [threadId, id] of [
      ["a", "old"],
      ["b", "other"],
    ])
      host.observeServerMessage({
        method: "turn/completed",
        params: { threadId, turn: { id, status: "completed" } },
      });
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    host.observeServerMessage({
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "new", status: "completed" } },
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("canonical thread idle suppresses a late acknowledgement of its observed active turn", () => {
    const { host, start, stop, status } = fixture();
    host.setPreventSleepWhileRunning(true);
    host.observeResult(
      "turn/start",
      { turn: { id: "t", status: "inProgress" } },
      { threadId: "a" },
    );
    status("a", "idle");
    host.observeResult(
      "turn/start",
      { turn: { id: "t", status: "inProgress" } },
      { threadId: "a" },
    );
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("cold active thread recovery releases on a terminal turn and ignores stale reads", () => {
    const { host, start, stop } = fixture();
    host.setPreventSleepWhileRunning(true);
    host.observeResult("thread/resume", {
      thread: { id: "a", status: { type: "active" } },
    });
    host.observeServerMessage({
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "t", status: "completed" } },
    });
    host.observeResult("thread/read", {
      thread: { id: "a", status: { type: "active" } },
    });
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("malformed or non-canonical turn acknowledgements never acquire; shutdown rejects late turns", () => {
    const { host, start } = fixture();
    host.setPreventSleepWhileRunning(true);
    for (const turn of [
      null,
      {},
      { id: "", status: "inProgress" },
      { id: "t", status: "running" },
    ])
      host.observeResult("turn/start", { turn }, { threadId: "a" });
    host.observeResult(
      "turn/start",
      { turn: { id: "t", status: "inProgress" } },
      {},
    );
    host.dispose();
    host.observeResult(
      "turn/start",
      { turn: { id: "t", status: "inProgress" } },
      { threadId: "a" },
    );
    host.observeServerMessage({
      method: "turn/started",
      params: { threadId: "a", turn: { id: "t", status: "inProgress" } },
    });
    expect(start).not.toHaveBeenCalled();
  });
});
