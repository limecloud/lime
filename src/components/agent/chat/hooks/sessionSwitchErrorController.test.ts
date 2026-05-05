import { describe, expect, it } from "vitest";
import {
  buildSessionSwitchErrorToastMessage,
  resolveSessionSwitchErrorAction,
} from "./sessionSwitchErrorController";

describe("sessionSwitchErrorController", () => {
  it("session not found 应清空当前快照并刷新 topics，但不弹 toast", () => {
    const error = new Error("session not found");

    expect(
      resolveSessionSwitchErrorAction({
        error,
        preserveCurrentSnapshot: true,
        topicId: "topic-a",
        workspaceId: "workspace-a",
      }),
    ).toEqual({
      clearCurrentSnapshot: true,
      kind: "session_not_found",
      logContext: {
        error,
        topicId: "topic-a",
        workspaceId: "workspace-a",
      },
      reloadTopics: true,
      showToast: false,
      toastMessage: null,
    });
  });

  it("普通错误默认应清空快照并弹出 toast", () => {
    const error = new Error("permission denied");

    expect(
      resolveSessionSwitchErrorAction({
        error,
        topicId: "topic-a",
      }),
    ).toMatchObject({
      clearCurrentSnapshot: true,
      kind: "clear_and_toast",
      reloadTopics: false,
      showToast: true,
      toastMessage: "加载对话历史失败: permission denied",
    });
  });

  it("preserveCurrentSnapshot 时普通错误只弹 toast，不清空当前快照", () => {
    expect(
      resolveSessionSwitchErrorAction({
        error: "fetch failed",
        preserveCurrentSnapshot: true,
        topicId: "topic-a",
      }),
    ).toMatchObject({
      clearCurrentSnapshot: false,
      kind: "toast_only",
      reloadTopics: false,
      showToast: true,
      toastMessage: "加载对话历史失败: fetch failed",
    });
  });

  it("toast 文案应兼容非 Error 错误", () => {
    expect(buildSessionSwitchErrorToastMessage("bad gateway")).toBe(
      "加载对话历史失败: bad gateway",
    );
  });
});
