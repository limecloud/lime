import { describe, expect, it } from "vitest";
import {
  flushEffects,
  renderPage,
  sharedSendMessageMock,
  sharedTriggerAIGuideMock,
} from "./index.testFixtures";

describe("AgentChatPage 通用工作区无专用视频模式", () => {
  it("general 主题仍应渲染底部通用输入条，且不应自动发送首条请求", async () => {
    const container = renderPage({
      projectId: "project-video",
      contentId: "content-video",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(container.querySelector('[data-testid="inputbar"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="general-workbench-sidebar"]'),
    ).toBeNull();
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
  });
});
