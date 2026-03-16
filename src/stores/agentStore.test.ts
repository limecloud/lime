import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConfirmAsterAction,
  mockCreateAsterSession,
  mockDeleteAsterSession,
  mockGetAsterSession,
  mockInitAsterAgent,
  mockListAsterSessions,
  mockParseStreamEvent,
  mockRequireDefaultProjectId,
  mockResolveRestorableSessionId,
  mockSafeListen,
  mockSendAsterMessageStream,
  mockStopAsterSession,
  mockSubmitAsterElicitationResponse,
} = vi.hoisted(() => ({
  mockConfirmAsterAction: vi.fn(),
  mockCreateAsterSession: vi.fn(),
  mockDeleteAsterSession: vi.fn(),
  mockGetAsterSession: vi.fn(),
  mockInitAsterAgent: vi.fn(),
  mockListAsterSessions: vi.fn(),
  mockParseStreamEvent: vi.fn((payload: unknown) => payload),
  mockRequireDefaultProjectId: vi.fn(),
  mockResolveRestorableSessionId: vi.fn(() => null),
  mockSafeListen: vi.fn(),
  mockSendAsterMessageStream: vi.fn(),
  mockStopAsterSession: vi.fn(),
  mockSubmitAsterElicitationResponse: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  confirmAsterAction: mockConfirmAsterAction,
  createAsterSession: mockCreateAsterSession,
  deleteAsterSession: mockDeleteAsterSession,
  getAsterSession: mockGetAsterSession,
  initAsterAgent: mockInitAsterAgent,
  listAsterSessions: mockListAsterSessions,
  sendAsterMessageStream: mockSendAsterMessageStream,
  stopAsterSession: mockStopAsterSession,
  submitAsterElicitationResponse: mockSubmitAsterElicitationResponse,
}));

vi.mock("@/lib/api/agentStream", () => ({
  parseStreamEvent: mockParseStreamEvent,
}));

vi.mock("@/lib/api/project", () => ({
  requireDefaultProjectId: mockRequireDefaultProjectId,
}));

vi.mock("@/lib/asterSessionRecovery", () => ({
  isAsterSessionNotFoundError: vi.fn(() => false),
  resolveRestorableSessionId: mockResolveRestorableSessionId,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

import { useAgentStore } from "./agentStore";

function resetStore() {
  useAgentStore.getState()._cleanup();
  useAgentStore.setState({
    currentSessionId: null,
    sessions: [],
    messages: [],
    isStreaming: false,
    currentAssistantMsgId: null,
    pendingActions: [],
    isInitialized: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockConfirmAsterAction.mockResolvedValue(undefined);
  mockCreateAsterSession.mockResolvedValue("session-created");
  mockDeleteAsterSession.mockResolvedValue(undefined);
  mockGetAsterSession.mockResolvedValue({ messages: [] });
  mockInitAsterAgent.mockResolvedValue(undefined);
  mockListAsterSessions.mockResolvedValue([]);
  mockParseStreamEvent.mockImplementation((payload: unknown) => payload);
  mockRequireDefaultProjectId.mockResolvedValue("workspace-test");
  mockSafeListen.mockResolvedValue(() => {});
  mockSendAsterMessageStream.mockResolvedValue(undefined);
  mockStopAsterSession.mockResolvedValue(undefined);
  mockSubmitAsterElicitationResponse.mockResolvedValue(undefined);

  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("useAgentStore 权限响应", () => {
  it("ask_user 经 action_required 进入 store 后应保留 questions 并透传 metadata", async () => {
    useAgentStore.setState({
      currentSessionId: "session-store-ask",
      currentAssistantMsgId: "assistant-store-ask",
    });

    useAgentStore.getState()._handleEvent({
      type: "action_required",
      request_id: "req-store-ask-1",
      action_type: "ask_user",
      prompt: "请补充任务信息",
      questions: [
        { question: "这次主要面向谁？" },
        { question: "这次最想达成什么？" },
      ],
    });

    expect(useAgentStore.getState().pendingActions).toMatchObject([
      {
        requestId: "req-store-ask-1",
        actionType: "ask_user",
        prompt: "请补充任务信息",
        questions: [
          { question: "这次主要面向谁？" },
          { question: "这次最想达成什么？" },
        ],
      },
    ]);

    await useAgentStore.getState().confirmAction({
      requestId: "req-store-ask-1",
      confirmed: true,
      userData: {
        question_1: "客户",
        question_2: "提高转化",
      },
    });

    expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledWith(
      "session-store-ask",
      "req-store-ask-1",
      {
        question_1: "客户",
        question_2: "提高转化",
      },
      {
        elicitation_context: {
          source: "action_required",
          mode: "runtime_protocol",
          form_id: "req-store-ask-1",
          action_type: "ask_user",
          field_count: 2,
          prompt: "请补充任务信息",
          entries: [
            {
              fieldId: "req-store-ask-1_question_1",
              fieldKey: "question_1",
              label: "这次主要面向谁？",
              value: "客户",
              summary: "客户",
            },
            {
              fieldId: "req-store-ask-1_question_2",
              fieldKey: "question_2",
              label: "这次最想达成什么？",
              value: "提高转化",
              summary: "提高转化",
            },
          ],
        },
      },
    );
    expect(useAgentStore.getState().pendingActions).toHaveLength(0);
  });

  it("elicitation schema 提交应透传 schema 派生的结构化 metadata", async () => {
    useAgentStore.setState({
      currentSessionId: "session-store-elicitation",
      currentAssistantMsgId: "assistant-store-elicitation",
    });

    useAgentStore.getState()._handleEvent({
      type: "action_required",
      request_id: "req-store-elicitation-1",
      action_type: "elicitation",
      prompt: "请确认本次任务配置",
      requested_schema: {
        type: "object",
        properties: {
          audience: {
            type: "string",
            title: "目标受众",
          },
          include_cta: {
            type: "boolean",
            title: "加入行动号召",
          },
        },
      },
    });

    await useAgentStore.getState().confirmAction({
      requestId: "req-store-elicitation-1",
      confirmed: true,
      userData: {
        audience: "潜在客户",
        include_cta: true,
      },
    });

    expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledWith(
      "session-store-elicitation",
      "req-store-elicitation-1",
      {
        audience: "潜在客户",
        include_cta: true,
      },
      {
        elicitation_context: {
          source: "action_required",
          mode: "runtime_protocol",
          form_id: "req-store-elicitation-1",
          action_type: "elicitation",
          field_count: 2,
          prompt: "请确认本次任务配置",
          entries: [
            {
              fieldId: "req-store-elicitation-1_audience",
              fieldKey: "audience",
              label: "目标受众",
              value: "潜在客户",
              summary: "潜在客户",
            },
            {
              fieldId: "req-store-elicitation-1_include_cta",
              fieldKey: "include_cta",
              label: "加入行动号召",
              value: true,
              summary: "是",
            },
          ],
        },
      },
    );
  });
});
