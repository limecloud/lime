import { describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  prepareAgentStreamUserInputSend,
  type AgentStreamUserInputSendPreparationEnv,
} from "./agentStreamUserInputSendPreparation";
import { buildTurnInput } from "../utils/buildUserInputSubmitOp";
import type { InputCapabilitySendRoute } from "../skill-selection/inputCapabilitySelection";

function createEnv(): AgentStreamUserInputSendPreparationEnv {
  return {
    executionStrategy: "react",
    providerTypeRef: { current: "openai" },
    modelRef: { current: "fixture" },
    reasoningEffortRef: { current: "" },
    sessionIdRef: { current: "session-1" },
    executionRuntime: null,

    getWorkspaceIdForSubmit: () => "workspace-1",
    getSyncedSessionModelPreference: () => null,
    setMessages: vi.fn(),
    setIsSending: vi.fn(),
  };
}

describe("Composer send preparation", () => {
  it.each(["missing", "conflicting", "absent_original"] as const)(
    "keeps the receipt restore route independent of dispatch fallback (%s)",
    (scenario) => {
      const originalRoute: InputCapabilitySendRoute | undefined =
        scenario === "absent_original"
          ? undefined
          : {
              kind: "curated_task",
              taskId: "original-task",
              taskTitle: "原始任务",
              prompt: "原始任务正文",
              launchInputValues: { audience: "开发者" },
            };
      const dispatchRoute: InputCapabilitySendRoute | undefined =
        scenario === "missing"
          ? undefined
          : {
              kind: "builtin_command",
              commandKey: "dispatch-command",
              commandPrefix: "/dispatch-command",
            };
      const fallbackRoute: InputCapabilitySendRoute = {
        kind: "builtin_command",
        commandKey: "fallback-skill",
        commandPrefix: "@inspect",
      };
      const controller = new ComposerController({
        text: "A😀 原始草稿",
        inputCapabilityRoute: originalRoute,
      });
      controller.ingestPaste("完整粘贴正文".repeat(300));
      const receipt = controller.submit("start");
      const prepared = prepareAgentStreamUserInputSend({
        content: receipt.submission.text,
        images: [],
        skipUserMessage: false,
        options: {
          composerDraft: receipt.draft,
          composerSubmission: receipt.submission,
          ...(dispatchRoute
            ? {
                capabilityRoute: dispatchRoute,
                inputRestoreDraft: {
                  text: "备用恢复正文",
                  inputCapabilityRoute: fallbackRoute,
                },
              }
            : {}),
        },
        env: createEnv(),
      });

      expect(prepared.submittedDraft).toMatchObject(receipt.draft);
      expect(prepared.submittedDraft?.inputCapabilityRoute).toEqual(
        originalRoute,
      );
      expect(prepared.userMsg?.inputCapabilityRoute).toEqual(dispatchRoute);
      expect(prepared.composerSubmission).toEqual(receipt.submission);
      expect(controller.captureDraft()).toEqual(receipt.draft);
      if (originalRoute) {
        expect(prepared.submittedDraft?.inputCapabilityRoute).not.toBe(
          receipt.draft.inputCapabilityRoute,
        );
      }
    },
  );

  it.each([false, true])(
    "keeps nonstructured restore routing when explicit restore draft is %s",
    (hasRestoreDraft) => {
      const dispatchRoute: InputCapabilitySendRoute = {
        kind: "builtin_command",
        commandKey: "dispatch-command",
        commandPrefix: "/dispatch-command",
      };
      const restoreRoute: InputCapabilitySendRoute = {
        kind: "builtin_command",
        commandKey: "restore-skill",
        commandPrefix: "@inspect",
      };
      const prepared = prepareAgentStreamUserInputSend({
        content: "发送正文",
        images: [],
        skipUserMessage: false,
        options: {
          capabilityRoute: dispatchRoute,
          ...(hasRestoreDraft
            ? {
                inputRestoreDraft: {
                  text: "恢复正文",
                  inputCapabilityRoute: restoreRoute,
                },
              }
            : {}),
        },
        env: createEnv(),
      });
      expect(prepared.submittedDraft).toMatchObject({
        text: hasRestoreDraft ? "恢复正文" : "发送正文",
        inputCapabilityRoute: hasRestoreDraft ? restoreRoute : dispatchRoute,
      });
      expect(prepared.userMsg?.inputCapabilityRoute).toEqual(dispatchRoute);
    },
  );

  it("compiles only the submission and preserves the folded restore document", () => {
    const controller = new ComposerController({ text: "A😀 " });
    controller.setSelection(4);
    controller.insertMention({
      id: "skill-1",
      kind: "skill",
      name: "x",
      path: "/skills/x",
      label: "@x",
    });
    controller.ingestPaste("原始内容".repeat(300));
    controller.setAttachments([
      {
        data: "",
        mediaType: "image/png",
        sourceUri: "media://1",
        index: 3,
        metadata: { media_id: "1" },
      },
    ]);
    const receipt = controller.submit("start");
    const env = createEnv();
    const prepared = prepareAgentStreamUserInputSend({
      content: `上下文\n${receipt.submission.text.trim()}`,
      images: [],
      skipUserMessage: false,
      options: {
        composerDraft: receipt.draft,
        composerSubmission: receipt.submission,
        inputMentions: [
          { type: "mention", name: "wrong", path: "plugin://wrong" },
        ],
      },
      env,
    });
    expect(prepared.submittedDraft).toMatchObject({
      ...receipt.draft,
      inputCapabilityRoute: undefined,
    });
    expect(prepared.submittedDraft?.text).toContain("[Pasted text");
    expect(prepared.composerSubmission?.text).toContain("原始内容".repeat(300));
    expect(prepared.inputMentions).toEqual(receipt.submission.inputMentions);
    expect(prepared.images).toEqual(receipt.submission.attachments);
    expect(
      buildTurnInput({
        content: prepared.content,
        images: prepared.images,
        composerSubmission: prepared.composerSubmission,
      }),
    ).toContainEqual({ type: "image", url: "media://1" });
    expect(prepared.submittedDraft?.editorDocument).not.toBe(
      receipt.draft.editorDocument,
    );
  });

  it("does not infer wire ranges from restore metadata", () => {
    const prepared = prepareAgentStreamUserInputSend({
      content: "@x",
      images: [],
      skipUserMessage: false,
      options: {
        inputRestoreDraft: {
          text: "@x",
          textElements: [{ byteRange: { start: 0, end: 2 } }],
        },
      },
      env: createEnv(),
    });
    expect(prepared.composerSubmission).toBeUndefined();
    expect(
      buildTurnInput({
        content: prepared.content,
        images: [],
        composerSubmission: prepared.composerSubmission,
      }),
    ).toEqual([{ type: "text", text: "@x" }]);
  });

  it("invalid mapping fails before creating optimistic messages", () => {
    const env = createEnv();
    expect(() =>
      prepareAgentStreamUserInputSend({
        content: "rewritten",
        images: [],
        skipUserMessage: false,
        options: {
          composerSubmission: {
            text: "@x",
            textElements: [{ byteRange: { start: 0, end: 2 } }],
            inputMentions: [],
            attachments: [],
            pathReferences: [],
          },
        },
        env,
      }),
    ).toThrow("Cannot map");
    expect(env.setMessages).not.toHaveBeenCalled();
    expect(env.setIsSending).not.toHaveBeenCalled();
  });
});
