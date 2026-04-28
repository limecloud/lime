import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHasTauriInvokeCapability, mockWebviewWindow, mockGetByLabel } =
  vi.hoisted(() => {
    const ctor = vi.fn().mockImplementation(function (
      this: {
        label: string;
        options: Record<string, unknown>;
        once: (event: string, handler: () => void) => Promise<() => void>;
      },
      label: string,
      options: Record<string, unknown>,
    ) {
      this.label = label;
      this.options = options;
      this.once = vi.fn((_event: string, handler: () => void) => {
        handler();
        return Promise.resolve(() => undefined);
      });
    });

    return {
      mockHasTauriInvokeCapability: vi.fn(),
      mockWebviewWindow: ctor,
      mockGetByLabel: vi.fn(),
    };
  });

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: mockHasTauriInvokeCapability,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(mockWebviewWindow, {
    getByLabel: mockGetByLabel,
  }),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: (path: string) => `asset://${path}`,
}));

import {
  RESOURCE_MANAGER_SESSION_EVENT,
  RESOURCE_MANAGER_WINDOW_LABEL,
  openResourceManager,
} from "./openResourceManager";
import {
  RESOURCE_MANAGER_ACTIVE_SESSION_KEY,
  readResourceManagerSession,
} from "./resourceManagerSession";

describe("openResourceManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasTauriInvokeCapability.mockReturnValue(false);
    mockGetByLabel.mockResolvedValue(null);
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("Web 环境应写入会话并用浏览器窗口打开", async () => {
    const sessionId = await openResourceManager({
      items: [{ src: "https://example.com/a.pdf" }],
      sourceLabel: "项目资料",
      sourceContext: {
        kind: "project_resource",
        projectId: "project-1",
        contentId: "content-1",
      },
    });

    expect(sessionId).toBeTruthy();
    expect(localStorage.getItem(RESOURCE_MANAGER_ACTIVE_SESSION_KEY)).toBe(
      sessionId,
    );
    expect(readResourceManagerSession(sessionId)).toEqual(
      expect.objectContaining({
        sourceLabel: "项目资料",
        sourceContext: expect.objectContaining({
          kind: "project_resource",
          projectId: "project-1",
          contentId: "content-1",
        }),
      }),
    );
    expect(window.open).toHaveBeenCalledWith(
      `/resource-manager?session=${encodeURIComponent(sessionId!)}`,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("Tauri 环境应创建独立 resource-manager 窗口", async () => {
    mockHasTauriInvokeCapability.mockReturnValue(true);

    const sessionId = await openResourceManager({
      items: [{ src: "https://example.com/a.png", kind: "image" }],
    });

    expect(mockWebviewWindow).toHaveBeenCalledWith(
      RESOURCE_MANAGER_WINDOW_LABEL,
      expect.objectContaining({
        url: `/resource-manager?session=${encodeURIComponent(sessionId!)}`,
        title: "Lime 资源管理器",
        width: 1240,
      }),
    );
    expect(window.open).not.toHaveBeenCalled();
  });

  it("已有资源管理器窗口时应发送会话切换事件并聚焦", async () => {
    mockHasTauriInvokeCapability.mockReturnValue(true);
    const existingWindow = {
      emit: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    mockGetByLabel.mockResolvedValue(existingWindow);

    const sessionId = await openResourceManager({
      items: [{ src: "https://example.com/a.png", kind: "image" }],
    });

    expect(existingWindow.emit).toHaveBeenCalledWith(
      RESOURCE_MANAGER_SESSION_EVENT,
      {
        sessionId,
      },
    );
    expect(existingWindow.show).toHaveBeenCalledTimes(1);
    expect(existingWindow.setFocus).toHaveBeenCalledTimes(1);
    expect(mockWebviewWindow).not.toHaveBeenCalled();
  });
});
