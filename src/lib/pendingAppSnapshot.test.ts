import { beforeEach, describe, expect, it } from "vitest";
import {
  consumePendingAppSnapshot,
  getPendingAppSnapshot,
  resetPendingAppSnapshotForTest,
  restorePendingAppSnapshot,
  setPendingAppSnapshot,
} from "./pendingAppSnapshot";

const snapshot = {
  dataUrl: "data:image/png;base64,ZmFrZQ==",
  windowName: "Editor",
};

describe("pendingAppSnapshot", () => {
  beforeEach(() => {
    resetPendingAppSnapshotForTest();
  });

  it("一次性消费后清空，重复消费不再返回", () => {
    setPendingAppSnapshot(snapshot);

    expect(getPendingAppSnapshot()).toEqual(snapshot);
    expect(consumePendingAppSnapshot()).toEqual(snapshot);
    expect(consumePendingAppSnapshot()).toBeNull();
    expect(getPendingAppSnapshot()).toBeNull();
  });

  it("消费失败放回队列后可重试", () => {
    setPendingAppSnapshot(snapshot);
    const consumed = consumePendingAppSnapshot();
    expect(consumed).not.toBeNull();

    expect(restorePendingAppSnapshot(consumed!)).toBe(true);
    expect(consumePendingAppSnapshot()).toEqual(snapshot);
  });

  it("已有更新的快照时恢复不会覆盖", () => {
    setPendingAppSnapshot(snapshot);
    const consumed = consumePendingAppSnapshot();
    const newer = { ...snapshot, windowName: "Browser" };
    setPendingAppSnapshot(newer);

    expect(restorePendingAppSnapshot(consumed!)).toBe(false);
    expect(getPendingAppSnapshot()).toEqual(newer);
  });

  it("忽略空数据 URL", () => {
    setPendingAppSnapshot(snapshot);

    expect(
      setPendingAppSnapshot({ dataUrl: "   ", windowName: "Editor" }),
    ).toBe(false);
    expect(getPendingAppSnapshot()).toBeNull();
  });

  it("去除窗口名与数据 URL 首尾空白", () => {
    setPendingAppSnapshot({
      dataUrl: `  ${snapshot.dataUrl}  `,
      windowName: "  Editor  ",
    });

    expect(getPendingAppSnapshot()).toEqual(snapshot);
  });
});
