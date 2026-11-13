import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { Page } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { CloudModelSetupNotice } from "./CloudModelSetupNotice";

const api = vi.hoisted(() => ({
  bridge: vi.fn(),
  models: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/lib/electron-host", () => ({ getElectronHostBridge: api.bridge }));
vi.mock("@/lib/api/modelRegistry", () => ({
  getModelRegistry: api.models,
  subscribeModelRegistryUpdates: api.subscribe,
}));

const chat = {
  id: "chat-model",
  task_families: ["chat"],
  picker_policy: { show_in_picker: true },
};
let root: Root;
let container: HTMLDivElement;
let update: () => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function render(currentPage: Page = "agent") {
  await act(async () => {
    root.render(
      <CloudModelSetupNotice
        currentPage={currentPage}
        onNavigate={api.navigate}
      />,
    );
  });
}
async function click() {
  const button = container.querySelector("button");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  api.bridge.mockReturnValue({ cloudDesktop: { kind: "cloud" } });
  api.models.mockReset().mockResolvedValue([]);
  api.navigate.mockReset();
  api.unsubscribe.mockReset();
  api.subscribe.mockReset().mockImplementation((listener: () => void) => {
    update = listener;
    return api.unsubscribe;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("本机窗口不查询模型或订阅云端配置", async () => {
  api.bridge.mockReturnValue(undefined);
  await render();
  expect(container.textContent).toBe("");
  expect(api.models).not.toHaveBeenCalled();
  expect(api.subscribe).not.toHaveBeenCalled();
});

it("缺少模型时通过现有导航守卫进入设置，不另建凭据表单", async () => {
  await render();
  expect(api.models).toHaveBeenCalledExactlyOnceWith({ forceRefresh: true });
  expect(container.textContent).toContain("连接云端模型");
  expect(container.querySelector("input")).toBeNull();
  await click();
  expect(api.navigate).toHaveBeenCalledExactlyOnceWith("settings", {
    tab: SettingsTabs.Providers,
  });
  // The guard may defer navigation while preserving the current draft.
  expect(container.querySelector("aside")).not.toBeNull();
});

it("已有聊天模型不显示引导；目录变为空时立即重新提示", async () => {
  api.models.mockResolvedValueOnce([chat]);
  await render();
  expect(container.textContent).toBe("");
  await act(async () => update());
  expect(container.textContent).toContain("连接云端模型");
});

it.each([
  { ...chat, task_families: ["image_generation"] },
  { ...chat, task_families: [] },
  { ...chat, picker_policy: { show_in_picker: false } },
])("仅媒体模型、缺少聊天声明或隐藏目录不冒充聊天配置：%j", async (model) => {
  api.models.mockResolvedValue([model]);
  await render();
  expect(container.textContent).toContain("连接云端模型");
});

it("首次读取有进度，重复焦点事件不叠加请求", async () => {
  const pending = deferred<unknown>();
  api.models.mockReturnValue(pending.promise);
  await render();
  expect(container.querySelector("[role=status]")?.textContent).toBe(
    "正在检查云端模型配置…",
  );
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(api.models).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve([chat]));
  expect(container.textContent).toBe("");
});

it("读取失败只显示固定错误，重试期间禁用按钮并恢复", async () => {
  const pending = deferred<unknown>();
  api.models
    .mockRejectedValueOnce(new Error("untrusted-private-error"))
    .mockReturnValueOnce(pending.promise);
  await render();
  expect(container.querySelector("[role=alert]")?.textContent).toBe(
    "无法读取云端模型配置，请重试。",
  );
  expect(container.textContent).not.toContain("untrusted-private-error");
  await click();
  expect(container.querySelector("button")?.disabled).toBe(true);
  await click();
  expect(api.models).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve([chat]));
  expect(container.textContent).toBe("");
});

it("通知发起的新读取优先，迟到的旧目录不能覆盖新结果", async () => {
  const old = deferred<unknown>();
  const current = deferred<unknown>();
  api.models
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  await render();
  await act(async () => update());
  await act(async () => current.resolve([chat]));
  await act(async () => old.resolve([]));
  expect(container.textContent).toBe("");
});

it("设置页不重复引导，返回工作页读取新配置", async () => {
  const old = deferred<unknown>();
  api.models.mockReturnValueOnce(old.promise).mockResolvedValueOnce([chat]);
  await render();
  await render("settings");
  expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("");
  await render();
  await act(async () => old.reject(new Error("old-session")));
  expect(container.textContent).toBe("");
  expect(api.models).toHaveBeenCalledTimes(2);
});

it("窗口恢复焦点后重新检查，卸载后停止观察", async () => {
  api.models.mockResolvedValueOnce([chat]);
  await render();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("连接云端模型");
  await render("settings");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(api.models).toHaveBeenCalledTimes(2);
  expect(api.unsubscribe).toHaveBeenCalledTimes(1);
});

it.each([
  ["zh-CN", "连接模型"],
  ["zh-TW", "連接模型"],
  ["en-US", "Connect model"],
  ["ja-JP", "モデルに接続"],
  ["ko-KR", "모델 연결"],
] as const)("%s 使用本地化引导与按钮", async (locale, action) => {
  await changeLimeLocale(locale);
  await render();
  expect(
    container.querySelector("aside")?.getAttribute("aria-label"),
  ).toBeTruthy();
  expect(container.querySelector("button")?.textContent).toBe(action);
  expect(container.textContent).not.toContain("settings.cloudDesktop.");
  await click();
  expect(api.navigate).toHaveBeenCalledExactlyOnceWith("settings", {
    tab: SettingsTabs.Providers,
  });
});
