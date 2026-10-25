import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { changeLimeLocale } from "@/i18n/createI18n";

import type { Message, MessageImage } from "../types";
import type { WorkspacePathMissingState } from "./agentChatShared";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import type { StreamRequestState } from "./agentStreamRuntimeHandlerTypes";
import { handleAgentStreamSubmitFailure } from "./agentStreamSubmitFailure";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

function createStateSetter<T>(getValue: () => T, setValue: (value: T) => void) {
  return (next: T | ((prev: T) => T)) => {
    setValue(
      typeof next === "function" ? (next as (prev: T) => T)(getValue()) : next,
    );
  };
}

function noopDispatch<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

describe("handleAgentStreamSubmitFailure", () => {
  beforeEach(async () => {
    await changeLimeLocale("zh-CN");
  });

  afterEach(async () => {
    await changeLimeLocale("zh-CN");
  });



  it("提交失败不应绕过 read model 本地裁决 queued turn", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let messages: Message[] = [
      {
        id: "assistant-queued-submit-failure",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-07-04T01:00:00.000Z"),
        isThinking: true,
      },
    ];
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: Date.now(),
      requestFinished: false,
    };
    const clearActiveStreamIfMatch = vi.fn(() => true);
    const markOptimisticFailure = vi.fn();

    handleAgentStreamSubmitFailure({
      error: new Error("provider failed"),
      requestState,
      content: "排队输入",
      images: [] as MessageImage[],
      assistantMsgId: "assistant-queued-submit-failure",
      eventName: "turn-queued-submit-failure",
      activeStreamRef: {
        current: null,
      } as MutableRefObject<ActiveStreamState | null>,
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setWorkspacePathMissing: noopDispatch<WorkspacePathMissingState | null>(),
      setIsSending: noopDispatch<boolean>(),
      clearActiveStreamIfMatch,
      disposeListener: vi.fn(),
      markOptimisticFailure,
    });

    expect(markOptimisticFailure).toHaveBeenCalledWith("provider failed");
    expect(clearActiveStreamIfMatch).toHaveBeenCalledWith(
      "turn-queued-submit-failure",
    );
    expect(messages[0]).toMatchObject({
      id: "assistant-queued-submit-failure",
      isThinking: false,
      content: "provider failed",
    });
    consoleErrorSpy.mockRestore();
  });
});
