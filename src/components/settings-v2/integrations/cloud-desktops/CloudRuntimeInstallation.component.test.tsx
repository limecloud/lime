import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudRuntimeInstallation } from "./CloudRuntimeInstallation";

const invoke = vi.fn();
const resource = {
  provider: "ecs" as const,
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-test",
};
let root: Root;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function button(text: string) {
  const element = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent === text);
  expect(element).toBeTruthy();
  return element!;
}
async function click(text: string) {
  act(() => button(text).click());
  await settle();
}
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  invoke.mockReset();
  window.electronAPI = {
    invoke,
    supportsCommand: () => true,
    listen: () => () => undefined,
    emit: async () => undefined,
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.electronAPI;
});

it("requires both consents, sends no path or token, and allows closing while a background installation runs", async () => {
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: false,
    busy: false,
  });
  act(() =>
    root.render(<CloudRuntimeInstallation resource={resource} running />),
  );
  await settle();
  expect(invoke).not.toHaveBeenCalled();
  await click("安装运行环境");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cloud_desktop_connection", {
    request: { action: "installationStatus", resource },
  });
  expect(button("选择运行包并安装").disabled).toBe(true);
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  act(() => checkboxes[0].click());
  await settle();
  expect(button("选择运行包并安装").disabled).toBe(true);
  act(() => checkboxes[1].click());
  await settle();
  expect(button("选择运行包并安装").disabled).toBe(false);
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: true,
    phase: "launching",
    operationId: "original",
  });
  await click("选择运行包并安装");
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "installRuntime",
      resource,
      trustArtifact: true,
      createDesktopUser: true,
      confirmation: "installRuntime:cn-test:i-test",
    },
  });
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(button("继续原安装").disabled).toBe(true);
  expect(button("关闭").disabled).toBe(false);
  await click("关闭");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("resumes only the original operation and opens the saved connection without copying credentials", async () => {
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: false,
    phase: "needsAttention",
    operationId: "original",
  });
  act(() =>
    root.render(<CloudRuntimeInstallation resource={resource} running />),
  );
  await settle();
  await click("安装运行环境");
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: false,
    phase: "complete",
    connectionSaved: true,
    operationId: "original",
  });
  await click("继续原安装");
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "resumeInstallation",
      resource,
      operationId: "original",
    },
  });
  invoke.mockResolvedValue({ opened: true });
  await click("打开云窗口");
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: { action: "open", resource },
  });
});
