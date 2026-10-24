import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAgentStreamSubmit } from "./agentStreamSubmitExecution";
import {
  createAcceptanceOptions,
  createAcceptanceEnv,
} from "./agentStreamAcceptance.testFixtures";
import { sendAgentStreamMessage } from "./agentStreamSend";
import type { TurnStartResponse } from "@limecloud/app-server-client";
import type { Message } from "../types";
import { stopActiveAgentStream } from "./agentStreamFlowControl";
import { hasLocallyInterruptedAgentStreamBinding } from "./streamBindingRecords";
const { logMock } = vi.hoisted(() => ({ logMock: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: logMock }));
vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: vi.fn().mockResolvedValue({ models: [] }),
  },
}));
vi.mock("@/lib/api/permissionProfiles", () => ({
  resolveAllowedPermissionProfile: vi.fn().mockResolvedValue({ allowed: true }),
}));
afterEach(() => vi.clearAllMocks());
const response: TurnStartResponse = {
  turn: { id: "turn-response", status: "inProgress" },
};
describe("request-scoped runtime acceptance", () => {
  it("can stop an accepted turn before its first stream event arrives", async () => {
    const env = createAcceptanceEnv();
    let messages: Message[] = [];
    let currentTurnId: string | null = null;
    env.setMessages = (next) => {
      messages = typeof next === "function" ? next(messages) : next;
    };
    env.setCurrentTurnId = (next) => {
      currentTurnId = typeof next === "function" ? next(currentTurnId) : next;
    };
    env.setActiveStream = (next) => {
      env.activeStreamRef.current = next;
    };
    const interruptTurn = vi.fn().mockResolvedValue(true);
    Object.assign(env.runtime, {
      interruptTurn,
      getSessionReadModel: vi.fn().mockResolvedValue({ thread_items: [] }),
    });
    const accepted = vi.fn(() => {
      expect(currentTurnId).toBe("turn-start");
      expect(
        messages.find((message) => message.role === "assistant")?.runtimeTurnId,
      ).toBe("turn-start");
    });
    await sendAgentStreamMessage({
      content: "Stop before the first event",
      images: [],
      options: { observer: { onRuntimeAccepted: accepted } },
      env,
    });
    expect(accepted).toHaveBeenCalledTimes(1);
    // The fixture never delivers turn_started or any other stream event.
    expect(currentTurnId).toBe("turn-start");
    await stopActiveAgentStream({
      activeStream: env.activeStreamRef.current,
      sessionIdRef: env.sessionIdRef,
      threadId: "thread-1",
      currentTurnId,
      runtime: env.runtime,
      removeStreamListener: () => true,
      refreshSessionReadModel: env.refreshSessionReadModel,
      setThreadItems: env.setThreadItems,
      setThreadTurns: env.setThreadTurns,
      setCurrentTurnId: env.setCurrentTurnId,
      setMessages: env.setMessages,
      getMessages: () => messages,
      setActiveStream: env.setActiveStream,
      notify: { info: vi.fn(), error: vi.fn() },
    });
    expect(interruptTurn).toHaveBeenCalledWith(
      "thread-1",
      "turn-start",
      expect.any(String),
    );
    expect(
      hasLocallyInterruptedAgentStreamBinding({
        sessionId: "session-1",
        turnId: "turn-start",
      }),
    ).toBe(true);
    expect(env.activeStreamRef.current).toBeNull();
  });

  it("captures actual request session/thread before a later global ref changes", async () => {
    const { options, submitOp } = createAcceptanceOptions(null);
    const accepted = vi.fn();
    options.observer = { onRuntimeAccepted: accepted };
    submitOp.mockImplementation(async (_op, onAccepted) => {
      options.sessionIdRef.current = "another-session";
      onAccepted?.(response);
      return response;
    });
    const receipt = await executeAgentStreamSubmit(options);
    expect(receipt).toEqual({
      kind: "start",
      sessionId: "session-1",
      threadId: "thread-1",
      turnId: "turn-response",
      clientUserMessageId: "client-1",
    });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledWith(receipt);
    expect(JSON.stringify(submitOp.mock.calls[0][0])).not.toMatch(
      /draftId|scopeVersion|originScope|bindingGeneration/,
    );
  });
  it("keeps early actual acceptance when later adapter processing throws", async () => {
    const { options, submitOp } = createAcceptanceOptions(null);
    const accepted = vi.fn();
    options.observer = { onRuntimeAccepted: accepted };
    submitOp.mockImplementation(async (_op, onAccepted) => {
      onAccepted?.(response);
      throw new Error("post-response publication failed");
    });
    await expect(executeAgentStreamSubmit(options)).resolves.toMatchObject({
      turnId: "turn-response",
      sessionId: "session-1",
    });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      "AgentRuntime",
      "acceptance.postProcessingFailed",
      expect.objectContaining({ phase: "accepted_submit" }),
      { level: "error" },
    );
  });
  it("settles steer before refresh and preserves acceptance if read model and projection fail", async () => {
    const { options } = createAcceptanceOptions("turn-active");
    const order: string[] = [];
    options.observer = {
      onRuntimeAccepted: vi.fn(() => order.push("accepted")),
    };
    options.refreshSessionReadModel = vi.fn(async () => {
      order.push("refresh");
      throw new Error("PRIVATE READ ERROR");
    });
    options.setMessages = vi.fn(() => {
      throw new Error("PRIVATE UI ERROR");
    });
    await expect(executeAgentStreamSubmit(options)).resolves.toEqual({
      kind: "steer",
      sessionId: "session-1",
      threadId: "thread-1",
      turnId: "turn-active",
      clientUserMessageId: "client-1",
    });
    expect(order).toEqual(["accepted", "refresh"]);
    expect(
      logMock.mock.calls
        .filter((call) => call[1] === "acceptance.postProcessingFailed")
        .map((call) => call[2].phase),
    ).toEqual(["steer_read_model", "steer_projection"]);
    expect(JSON.stringify(logMock.mock.calls)).not.toContain("PRIVATE");
  });
  it("does not accept mismatched steer or a rejected request", async () => {
    const { options, steerTurn } = createAcceptanceOptions("turn-active");
    const accepted = vi.fn();
    options.observer = { onRuntimeAccepted: accepted };
    steerTurn.mockResolvedValue({ turnId: "wrong" });
    await expect(executeAgentStreamSubmit(options)).rejects.toThrow(
      "mismatched turnId",
    );
    expect(accepted).not.toHaveBeenCalled();
    const error = new Error("request rejected");
    steerTurn.mockRejectedValue(error);
    await expect(executeAgentStreamSubmit(options)).rejects.toBe(error);
    expect(accepted).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    true,
    {},
    { turn: { turnId: "old", status: "accepted" } },
  ])("does not accept legacy/unknown submit return %j", async (unknown) => {
    const { options, submitOp } = createAcceptanceOptions(null);
    const accepted = vi.fn();
    options.observer = { onRuntimeAccepted: accepted };
    submitOp.mockResolvedValue(unknown);
    await expect(executeAgentStreamSubmit(options)).rejects.toThrow();
    expect(accepted).not.toHaveBeenCalled();
  });
  it.each([null, "turn-active"])(
    "passes acceptance through real preparation/dispatch/submission chain for %s",
    async (activeTurn) => {
      const env = createAcceptanceEnv(activeTurn);
      const accepted = vi.fn();
      const receipt = await sendAgentStreamMessage({
        content: "A😀@x",
        images: [],
        options: { observer: { onRuntimeAccepted: accepted } },
        env,
      });
      expect(receipt).toMatchObject({
        kind: activeTurn ? "steer" : "start",
        sessionId: "session-1",
        threadId: "thread-1",
        turnId: activeTurn ?? "turn-start",
      });
      expect(accepted).toHaveBeenCalledTimes(1);
      expect(accepted).toHaveBeenCalledWith(receipt);
    },
  );
});
