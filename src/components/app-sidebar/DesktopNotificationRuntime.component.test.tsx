import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopNotificationRuntime } from "./DesktopNotificationRuntime";
import { resetNotificationPreferencesForTest, setNotificationPreferences } from "@/lib/notificationPreferences";

const mocks = vi.hoisted(() => ({
  handler: null as null | ((notifications: unknown[]) => void),
  notify: vi.fn(),
}));
vi.mock("@/lib/api/appServerEventBus", () => ({
  subscribeAppServerNotifications: (options: {
    onNotifications: (notifications: unknown[]) => void;
  }) => {
    mocks.handler = options.onNotifications;
    return () => undefined;
  },
}));
vi.mock("@/lib/api/desktopNotification", () => ({
  showDesktopNotification: mocks.notify,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  resetNotificationPreferencesForTest();
  mocks.notify.mockReset().mockResolvedValue({ status: "sent" });
  mocks.handler = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DesktopNotificationRuntime", () => {
  it("notifies once for an always-enabled completed turn", async () => {
    setNotificationPreferences({ turnComplete: "always", sound: false });
    act(() => root.render(<DesktopNotificationRuntime />));
    await act(async () => {
      mocks.handler?.([
        {
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
        },
      ]);
    });
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "任务已完成",
        silent: true,
      }),
    );
    await act(async () => {
      mocks.handler?.([
        {
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
        },
      ]);
    });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
});
