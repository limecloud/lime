import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  closeScreenshotChatWindow,
  sendScreenshotChat,
} from "./screenshotChat";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("screenshotChat API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理截图聊天发送与关闭窗口", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      sendScreenshotChat({
        message: "hello",
        imagePath: "/tmp/demo.png",
      }),
    ).resolves.toBeUndefined();
    await expect(closeScreenshotChatWindow()).resolves.toBeUndefined();

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "send_screenshot_chat", {
      message: "hello",
      imagePath: "/tmp/demo.png",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(
      2,
      "close_screenshot_chat_window",
    );
  });
});
