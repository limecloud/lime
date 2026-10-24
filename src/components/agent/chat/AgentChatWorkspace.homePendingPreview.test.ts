import { describe, expect, it } from "vitest";
import {
  buildHomePendingPreviewMessages,
  type TaskCenterDraftSendRequest,
} from "./homePendingPreview";
import {
  resolveSoulInteractionCopy,
  type SoulInteractionCopy,
} from "@/lib/soul/interactionCopy";

function withChinesePreparingCopy(
  copy: SoulInteractionCopy,
): SoulInteractionCopy {
  return {
    ...copy,
    preparingTitle: "正在进入对话",
    preparingDetail: "已收到输入，正在后台准备会话和执行环境。",
  };
}

describe("buildHomePendingPreviewMessages", () => {
  it("首页首发等待态保留可见正文，不生成额外 Skill 路由", () => {
    const request: TaskCenterDraftSendRequest = {
      id: "draft-send-1",
      sessionId: "session-1",
      text: "帮我整理资料",
      images: [],
      sendExecutionStrategy: "react",
      sendOptions: {
        displayContent: "帮我整理资料",
        inputMentions: [
          {
            type: "skill",
            name: "personal-ip-knowledge-builder",
            path: "/skills/personal-ip-knowledge-builder/SKILL.md",
          },
        ],
      },
      submittedAt: 1_710_000_000_000,
      source: "empty-state",
    };

    const messages = buildHomePendingPreviewMessages(
      request,
      "react",
      withChinesePreparingCopy(resolveSoulInteractionCopy()),
    );

    expect(messages[0]).toMatchObject({
      id: "draft-send-1:user",
      role: "user",
      content: "帮我整理资料",
      inputCapabilityRoute: undefined,
    });
    expect(messages[1]).toMatchObject({
      id: "draft-send-1:assistant",
      role: "assistant",
      isThinking: true,
      runtimeStatus: {
        phase: "preparing",
        title: "正在进入对话",
      },
    });
  });

  it("首页首发等待态应保持 neutral 文案并携带 memory.soul metadata", () => {
    const request: TaskCenterDraftSendRequest = {
      id: "draft-send-soul",
      sessionId: "session-soul",
      text: "帮我整理资料",
      images: [],
      submittedAt: 1_710_000_000_000,
      source: "empty-state",
    };

    const messages = buildHomePendingPreviewMessages(
      request,
      "react",
      withChinesePreparingCopy(
        resolveSoulInteractionCopy({
          soul: {
            enabled: true,
            style_profile_id: "cheeky_sassy_executor",
          },
        }),
      ),
    );

    expect(messages[1]).toMatchObject({
      role: "assistant",
      runtimeStatus: {
        phase: "preparing",
        title: "正在进入对话",
        detail: "已收到输入，正在后台准备会话和执行环境。",
        metadata: {
          soul_surface: "home_pending_preview",
          soul_phase: "preparing",
          style_level: "L1",
          risk_level: "normal",
          tone_variant: "cheeky_sassy",
          profile_id: "cheeky_sassy_executor",
          pack_id: "com.lime.soul.cheeky-sassy-executor",
        },
      },
    });
  });
});
