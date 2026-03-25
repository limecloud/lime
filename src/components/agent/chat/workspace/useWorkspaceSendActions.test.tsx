import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";

const mockPreheatBrowserAssistInBackground = vi.hoisted(() => vi.fn());

vi.mock("../utils/browserAssistPreheat", () => ({
  preheatBrowserAssistInBackground: mockPreheatBrowserAssistInBackground,
}));

type HookProps = Parameters<typeof useWorkspaceSendActions>[0];

interface HookHarness {
  getValue: () => ReturnType<typeof useWorkspaceSendActions>;
  unmount: () => void;
}

const mockSendMessage = vi.fn<HookProps["sendMessage"]>(async () => undefined);
const mockPrepareRuntimeTeamBeforeSend = vi.fn<HookProps["prepareRuntimeTeamBeforeSend"]>(
  async () => null,
);
const mockFinalizeAfterSendSuccess = vi.fn();
const mockRollbackAfterSendFailure = vi.fn();
const mockSetInput = vi.fn();
const mockSetMentionedCharacters = vi.fn();
const mockSetChatToolPreferences = vi.fn();
const mockSetRuntimeTeamDispatchPreview = vi.fn();
const mockEnsureBrowserAssistCanvas = vi.fn(async () => true);
const mockHandleImageWorkbenchCommand = vi.fn(async () => false);

function createPreparedRuntimeTeamState(): TeamWorkspaceRuntimeFormationState {
  return {
    requestId: "runtime-team-preview-1",
    status: "formed",
    label: "研究协作组",
    summary: "按调研、分析、汇总三段推进",
    members: [
      {
        id: "researcher",
        label: "研究员",
        summary: "负责收集资料",
        skillIds: [],
        status: "planned",
        latestSnippet: null,
      },
    ],
    blueprint: {
      label: "研究协作组",
      summary: "按调研、分析、汇总三段推进",
      roles: [
        {
          id: "researcher",
          label: "研究员",
          summary: "负责收集资料",
          skillIds: [],
        },
      ],
    },
    errorMessage: null,
    updatedAt: 1_710_000_000_000,
  };
}

function mountHook(initialProps?: Partial<HookProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useWorkspaceSendActions> | null = null;
  const props: HookProps = {
    input: "继续处理当前话题",
    setInput: mockSetInput,
    mentionedCharacters: [],
    setMentionedCharacters: mockSetMentionedCharacters,
    chatToolPreferences: {
      webSearch: false,
      thinking: false,
      task: false,
      subagent: false,
    },
    setChatToolPreferences: mockSetChatToolPreferences,
    activeTheme: "general",
    mappedTheme: "general",
    isThemeWorkbench: false,
    contextWorkspace: {
      enabled: false,
      prepareActiveContextPrompt: async () => "",
    },
    runtimeStyleMessagePrompt: "",
    projectId: "project-1",
    executionStrategy: "react",
    preferredTeamPresetId: null,
    selectedTeam: null,
    selectedTeamLabel: "",
    selectedTeamSummary: "",
    currentGateKey: "default_gate",
    themeWorkbenchActiveQueueTitle: undefined,
    contentId: null,
    messagesCount: 0,
    sendMessage: mockSendMessage,
    resolveSendBoundary: (({ sourceText }) => ({
      sourceText,
      browserRequirementMatch: null,
      shouldConsumePendingThemeWorkbenchInitialPrompt: false,
      shouldDismissThemeWorkbenchEntryPrompt: false,
    })) as HookProps["resolveSendBoundary"],
    isBlockedByBrowserPreflight: (() => false) as HookProps["isBlockedByBrowserPreflight"],
    maybeStartBrowserTaskPreflight:
      (() => false) as HookProps["maybeStartBrowserTaskPreflight"],
    finalizeAfterSendSuccess:
      mockFinalizeAfterSendSuccess as HookProps["finalizeAfterSendSuccess"],
    rollbackAfterSendFailure:
      mockRollbackAfterSendFailure as HookProps["rollbackAfterSendFailure"],
    prepareRuntimeTeamBeforeSend:
      mockPrepareRuntimeTeamBeforeSend as HookProps["prepareRuntimeTeamBeforeSend"],
    setRuntimeTeamDispatchPreview:
      mockSetRuntimeTeamDispatchPreview as HookProps["setRuntimeTeamDispatchPreview"],
    ensureBrowserAssistCanvas:
      mockEnsureBrowserAssistCanvas as HookProps["ensureBrowserAssistCanvas"],
    handleImageWorkbenchCommand:
      mockHandleImageWorkbenchCommand as HookProps["handleImageWorkbenchCommand"],
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useWorkspaceSendActions(props);
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useWorkspaceSendActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    vi.clearAllMocks();
  });

  it("普通发送不应把当前工作区模型当成 modelOverride", async () => {
    const harness = mountHook();
    const autoContinue = {
      enabled: true,
      fast_mode_enabled: false,
      continuation_length: 3,
      sensitivity: 0.4,
    };

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend(
          [],
          false,
          false,
          "继续处理当前话题",
          "react",
          autoContinue,
        );
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const args =
        mockSendMessage.mock.calls[0] as Parameters<HookProps["sendMessage"]>;
      expect(args?.[6]).toBeUndefined();
      expect(args?.[7]).toEqual(autoContinue);
      expect(args?.[8]).toMatchObject({
        requestMetadata: {
          harness: expect.objectContaining({
            theme: "general",
            session_mode: "default",
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("发送前如果准备出本地 team，应写入短生命周期 dispatch preview", async () => {
    mockPrepareRuntimeTeamBeforeSend.mockResolvedValueOnce(
      createPreparedRuntimeTeamState(),
    );
    const harness = mountHook({
      input: "请拆解这个复杂需求，并安排多人协作推进",
      chatToolPreferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      },
      messagesCount: 3,
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSetRuntimeTeamDispatchPreview).toHaveBeenNthCalledWith(1, null);
      expect(mockSetRuntimeTeamDispatchPreview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          key: "runtime-team-preview-1",
          prompt: "请拆解这个复杂需求，并安排多人协作推进",
          baseMessageCount: 3,
          status: "formed",
          formationState: expect.objectContaining({
            requestId: "runtime-team-preview-1",
            label: "研究协作组",
          }),
        }),
      );
    } finally {
      harness.unmount();
    }
  });
});
