import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { prepareAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import { submitAgentStreamUserInput } from "./agentStreamUserInputSubmission";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";

vi.mock("@/lib/api/permissionProfiles", () => ({
  resolveAllowedPermissionProfile: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: vi.fn().mockResolvedValue({ models: [] }),
  },
}));
afterEach(() => {
  activityLogger.clear();
  vi.restoreAllMocks();
});

describe("structured submission acceptance", () => {
  it.each([null, "turn-active"])(
    "propagates runtime rejection after cleanup when active turn is %s",
    async (activeTurnId) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const rejected = new Error("runtime rejected this input");
      const submitOp = vi.fn().mockRejectedValue(rejected);
      const steerTurn = vi.fn().mockRejectedValue(rejected);
      const observer = { onError: vi.fn() };
      const env: AgentStreamPreparedSendEnv = {
        runtime: {
          listenToTurnEvents: vi.fn().mockResolvedValue(vi.fn()),
          getThreadTurnControl: vi.fn().mockResolvedValue({
            activeTurnId,
            queuedTurnIds: [],
            threadId: "thread-1",
            updatedAtMs: 0,
          }),
          submitOp,
          steerTurn,
        } as unknown as AgentRuntimeAdapter,
        executionStrategy: "react",
        accessMode: "current",
        executionRuntime: null,

        providerTypeRef: { current: "openai" },
        modelRef: { current: "fixture" },
        reasoningEffortRef: { current: "" },
        sessionIdRef: { current: "session-1" },
        runPreparedSubmit: (task) => task(),
        getWorkspaceIdForSubmit: () => "workspace-1",
        getThreadIdForSubmit: () => "thread-1",
        getSyncedSessionExecutionStrategy: () => "react",
        getSyncedSessionModelPreference: () => null,
        ensureSession: vi.fn().mockResolvedValue("session-1"),
        attemptSilentTurnRecovery: vi.fn().mockResolvedValue(false),
        refreshSessionReadModel: vi.fn().mockResolvedValue(true),
        warnedKeysRef: { current: new Set() },
        listenerMapRef: { current: new Map() },
        activeStreamRef: { current: null },
        setActiveStream: vi.fn(),
        clearActiveStreamIfMatch: vi.fn().mockReturnValue(true),
        setMessages: vi.fn(),
        setThreadItems: vi.fn(),
        setThreadTurns: vi.fn(),
        setCurrentTurnId: vi.fn(),
        setExecutionRuntime: vi.fn(),
        setPendingActions: vi.fn(),
        setWorkspacePathMissing: vi.fn(),
        setIsSending: vi.fn(),
        appendThinkingToParts: (parts) => parts,
      };
      const submission = {
        text: "A😀@x",
        textElements: [{ byteRange: { start: 5, end: 7 }, placeholder: "@x" }],
        inputMentions: [
          { type: "skill" as const, name: "x", path: "/skills/x" },
        ],
        attachments: [],
        pathReferences: [],
      };
      const preparedSend = prepareAgentStreamUserInputSend({
        content: submission.text,
        images: [],
        skipUserMessage: false,
        options: { composerSubmission: submission, observer },
        env,
      });
      await expect(
        submitAgentStreamUserInput({ preparedSend, env }),
      ).rejects.toBe(rejected);
      expect(observer.onError).toHaveBeenCalledWith(rejected.message);
      expect(env.clearActiveStreamIfMatch).toHaveBeenCalled();
      expect(env.setIsSending).toHaveBeenLastCalledWith(false);
      const dispatched = activeTurnId
        ? steerTurn.mock.calls[0][0]
        : submitOp.mock.calls[0][0].turn;
      expect(dispatched).toMatchObject({
        clientUserMessageId: preparedSend.userMsgId,
        input: [
          {
            type: "text",
            text: submission.text,
            text_elements: submission.textElements,
          },
          ...submission.inputMentions,
        ],
      });
    },
  );
});
