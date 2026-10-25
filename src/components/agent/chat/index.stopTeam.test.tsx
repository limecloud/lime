import { describe, expect, it, vi } from "vitest";
import {
  createMockAgentChatUnifiedState,
  flushEffects,
  getIndexTestMocks,
  installMockAgentChatUnifiedState,
  type MockInputbarSendProps,
  renderPage,
} from "./index.testFixtures";

const { mockInputbar, mockToast } = getIndexTestMocks();

describe("LocalConversationPage 停止 Team 协作", () => {
  it("点击停止时只停止主输出，不调用或提示已删除的子任务控制", async () => {
    const stopSendingMock = vi.fn(async () => undefined);

    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        isSending: true,
        stopSending: stopSendingMock,
      }),
    );
    renderPage();
    await flushEffects();

    const latestInputbarProps = [...mockInputbar.mock.calls]
      .map((call) => call[0] as MockInputbarSendProps | undefined)
      .reverse()
      .find((props) => typeof props?.onStop === "function");

    expect(latestInputbarProps?.onStop).toBeTypeOf("function");

    await latestInputbarProps?.onStop?.();
    await flushEffects();

    expect(stopSendingMock).toHaveBeenCalledTimes(1);
    expect(mockToast.info).not.toHaveBeenCalled();
  });
});
