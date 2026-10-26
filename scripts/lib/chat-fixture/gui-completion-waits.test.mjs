import { describe, expect, it } from "vitest";

import { isGuiCanceledSnapshotReady } from "./gui-completion-waits.mjs";

const BASE_CANCELED_SNAPSHOT = {
  hasPrompt: true,
  hasStoppedCopy: false,
  hasPartialText: false,
  editorVisible: true,
  editorDisabled: false,
  stopButtonVisible: false,
  approvalRecordShape: {
    recordCount: 0,
  },
  compactTimelinePreviewCount: 0,
};

describe("chat GUI cancellation", () => {
  it("普通 cancel 必须等到停止文案出现", () => {
    expect(isGuiCanceledSnapshotReady(BASE_CANCELED_SNAPSHOT)).toBe(false);
    expect(
      isGuiCanceledSnapshotReady({
        ...BASE_CANCELED_SNAPSHOT,
        hasStoppedCopy: true,
      }),
    ).toBe(true);
  });

  it("terminal / reopen cancel 可用 partial text 证明 GUI 已保留输出", () => {
    expect(
      isGuiCanceledSnapshotReady(BASE_CANCELED_SNAPSHOT, {
        partialText: "partial answer",
      }),
    ).toBe(false);
    expect(
      isGuiCanceledSnapshotReady(
        {
          ...BASE_CANCELED_SNAPSHOT,
          hasPartialText: true,
        },
        {
          partialText: "partial answer",
        },
      ),
    ).toBe(true);
  });

  it("approval cancel 终态不依赖历史 operational record", () => {
    expect(
      isGuiCanceledSnapshotReady({
        ...BASE_CANCELED_SNAPSHOT,
        hasStoppedCopy: true,
        compactTimelinePreviewCount: 1,
      }),
    ).toBe(true);
    expect(
      isGuiCanceledSnapshotReady({
        ...BASE_CANCELED_SNAPSHOT,
        hasStoppedCopy: true,
        compactTimelinePreviewCount: 1,
        approvalRecordShape: { recordCount: 1 },
      }),
    ).toBe(true);
  });
});
