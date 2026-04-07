import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import { maybeHandleSlashSkillBeforeSend } from "./agentStreamSlashSkillPreflight";

const { mockParseSkillSlashCommand, mockTryExecuteSlashSkillCommand } =
  vi.hoisted(() => ({
    mockParseSkillSlashCommand: vi.fn(),
    mockTryExecuteSlashSkillCommand: vi.fn(),
  }));

vi.mock("./skillCommand", () => ({
  parseSkillSlashCommand: (...args: unknown[]) =>
    mockParseSkillSlashCommand(...args),
  tryExecuteSlashSkillCommand: (...args: unknown[]) =>
    mockTryExecuteSlashSkillCommand(...args),
}));

function createPreparedSend(
  overrides: Partial<PreparedAgentStreamUserInputSend> = {},
): PreparedAgentStreamUserInputSend {
  return {
    content: "/legacy_content_post 写一版主稿",
    images: [],
    skipUserMessage: false,
    expectingQueue: false,
    effectiveExecutionStrategy: "react",
    effectiveProviderType: "openai",
    effectiveModel: "gpt-5.4",
    syncedSessionModelPreference: null,
    assistantMsgId: "assistant-1",
    userMsgId: "user-1",
    assistantMsg: {
      id: "assistant-1",
      role: "assistant",
      content: "",
      timestamp: new Date("2026-04-07T12:00:00.000Z"),
      contentParts: [],
    },
    ...overrides,
  };
}

function createEnv() {
  return {
    ensureSession: async () => "session-1",
    sessionIdRef: { current: null },
    activeStreamRef: { current: null },
    listenerMapRef: { current: new Map() },
    setMessages: vi.fn(),
    setIsSending: vi.fn(),
    setActiveStream: vi.fn(),
    clearActiveStreamIfMatch: vi.fn(() => false),
    playTypewriterSound: vi.fn(),
    playToolcallSound: vi.fn(),
    onWriteFile: vi.fn(),
  } as never;
}

describe("agentStreamSlashSkillPreflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseSkillSlashCommand.mockReturnValue({
      skillName: "legacy_content_post",
      userInput: "写一版主稿",
    });
    mockTryExecuteSlashSkillCommand.mockResolvedValue(true);
  });

  it.each([
    {
      key: "service_scene_launch",
      launch: {
        kind: "cloud_scene",
        service_scene_run: {
          scene_key: "campaign-launch",
        },
      },
    },
    {
      key: "service_skill_launch",
      launch: {
        kind: "site_adapter",
        skill_id: "x-article-export",
      },
    },
  ])(
    "已携带 $key metadata 时不应再回退旧 slash skill preflight",
    async ({ key, launch }) => {
      const env = createEnv();
      const handled = await maybeHandleSlashSkillBeforeSend({
        preparedSend: createPreparedSend({
          content:
            key === "service_scene_launch"
              ? "/campaign-launch 帮我做一版新品活动方案"
              : "/x文章转存 https://x.com/GoogleCloudTech/article/2033953579824758855",
          requestMetadata: {
            harness: {
              [key]: launch,
            },
          },
        }),
        env,
      });

      expect(handled).toBe(false);
      expect(mockParseSkillSlashCommand).not.toHaveBeenCalled();
      expect(mockTryExecuteSlashSkillCommand).not.toHaveBeenCalled();
      expect(env.setActiveStream).not.toHaveBeenCalled();
    },
  );

  it("未携带结构化 scene metadata 时仍应继续尝试旧 slash skill", async () => {
    const env = createEnv();
    const handled = await maybeHandleSlashSkillBeforeSend({
      preparedSend: createPreparedSend(),
      env,
    });

    expect(handled).toBe(true);
    expect(mockParseSkillSlashCommand).toHaveBeenCalledWith(
      "/legacy_content_post 写一版主稿",
    );
    expect(mockTryExecuteSlashSkillCommand).toHaveBeenCalledTimes(1);
    expect(env.setActiveStream).toHaveBeenCalledTimes(1);
  });
});
