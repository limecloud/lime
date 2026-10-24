import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  useWorkspaceSendActions,
  type WorkspaceHandleSend,
} from "./useWorkspaceSendActions";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { RuntimeSubmissionResult } from "../hooks/agentSendResult";
import { acceptedSubmission } from "../hooks/agentSendResult.testFixtures";

vi.mock("../skill-selection/runtimeInputCapabilityCatalog", () => ({
  useRuntimeMentionCommandCatalog: () => ({
    mentionAgentTurnRouteMap: {},
    mentionCommandSkillIdMap: {},
    mentionCommandPrefixKeyMap: {},
  }),
}));

describe("structured workspace acceptance", () => {
  it.each([true, false])(
    "runtime acceptance %s holds the dispatch lock and preserves newer rich input",
    async (accepted) => {
      await changeLimeLocale("zh-CN");
      (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
      ).IS_REACT_ACT_ENVIRONMENT = true;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const controller = new ComposerController({ text: "A😀 " });
      controller.setSelection(4);
      controller.ingestPaste("完整粘贴".repeat(300));
      const receipt = controller.submit("start");
      const acceptedResult = acceptedSubmission();
      const rejection = new Error("runtime rejected");
      let finishSend!: (accepted: boolean) => void;
      const pending = new Promise<RuntimeSubmissionResult>(
        (resolve, reject) => {
          finishSend = (value) =>
            value ? resolve(acceptedResult) : reject(rejection);
        },
      );
      const sendMessage = vi.fn<
        Parameters<typeof useWorkspaceSendActions>[0]["sendMessage"]
      >(() => pending);
      const setInput = vi.fn((text: string) => controller.setText(text));
      const rollbackAfterSendFailure = vi.fn();
      const finalizeAfterSendSuccess = vi.fn();
      let handleSend!: WorkspaceHandleSend;
      let preparing = false;
      const props: Parameters<typeof useWorkspaceSendActions>[0] = {
        input: receipt.draft.text,
        setInput,
        mentionedCharacters: [],
        setMentionedCharacters: vi.fn(),
        chatToolPreferences: { task: false, subagent: false },
        setChatToolPreferences: vi.fn(),
        serviceSkills: [],
        activeTheme: "general",
        mappedTheme: "general",
        isThemeWorkbench: false,
        projectId: "project-1",
        projectRootPath: "/workspace",
        sessionId: "session-1",
        executionStrategy: "react",
        accessMode: "current",
        currentGateKey: "default_gate",
        contentId: null,
        messages: [],
        setChatMessages: vi.fn(),
        bootstrapDispatchPreview: null,
        sendMessage,
        resolveSendBoundary: (({ sourceText }) => ({
          sourceText,
          browserRequirementMatch: null,
          shouldConsumePendingGeneralWorkbenchInitialPrompt: false,
          shouldDismissGeneralWorkbenchEntryPrompt: false,
        })) as Parameters<
          typeof useWorkspaceSendActions
        >[0]["resolveSendBoundary"],
        finalizeAfterSendSuccess,
        rollbackAfterSendFailure,
        resolveImageWorkbenchCommandRequest: () => null,
      };
      function Harness() {
        const runtime = useWorkspaceSendActions(props);
        handleSend = runtime.handleSend;
        preparing = runtime.isPreparingSend;
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      try {
        act(() => root.render(<Harness />));
        let completion!: ReturnType<WorkspaceHandleSend>;
        await act(async () => {
          completion = handleSend(
            [],
            undefined,
            undefined,
            receipt.submission.text,
            "react",
            undefined,
            {
              composerDraft: receipt.draft,
              composerSubmission: receipt.submission,
              skipWorkspaceCommandRouting: true,
            },
          );
          await Promise.resolve();
        });
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(preparing).toBe(true);
        expect(
          await handleSend(
            [],
            undefined,
            undefined,
            receipt.submission.text,
            "react",
            undefined,
            {
              composerDraft: receipt.draft,
              composerSubmission: receipt.submission,
              skipWorkspaceCommandRouting: true,
            },
          ),
        ).toEqual({ kind: "rejected" });
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(controller.captureDraft()).toEqual(receipt.draft);
        expect(setInput).not.toHaveBeenCalled();
        controller.setText("新的文档😀");
        await act(async () => {
          finishSend(accepted);
          await completion;
        });
        expect(await completion).toEqual(
          accepted ? acceptedResult : { kind: "rejected", error: rejection },
        );
        expect(preparing).toBe(false);
        expect(controller.getDocument().text).toBe("新的文档😀");
        expect(setInput).not.toHaveBeenCalled();
        expect(rollbackAfterSendFailure).not.toHaveBeenCalled();
        expect(finalizeAfterSendSuccess).toHaveBeenCalledTimes(
          accepted ? 1 : 0,
        );
      } finally {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
      }
    },
  );
});
