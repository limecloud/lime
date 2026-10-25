import { changeLimeLocale } from "@/i18n/createI18n";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildHomePendingPreviewMessages,
  type TaskCenterDraftSendRequest,
} from "./homePendingPreview";




describe("buildHomePendingPreviewMessages", () => {
  beforeEach(async () => { await changeLimeLocale("zh-CN"); });
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
        title: "正在准备",
      },
    });
  });


});
