import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { CloudRuntimeInstallation } from "./CloudRuntimeInstallation";

const invoke = vi.fn();
const prepareConnection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/cloud", () => ({
  requestCloudDesktop: prepareConnection,
}));
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
  prepareConnection.mockReset();
  prepareConnection.mockImplementation(async (params) => ({
    data: {
      operationId: params.operationId,
      request: { action: params.action, resource: params.resource },
      observedResource: params.resource,
      outcome: "connectionReady",
      phase: "complete",
      requiresInspection: false,
    },
  }));
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

it("defaults to the matching release, requires installation consent, and allows closing while it runs", async () => {
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
  expect(button("安装此版本 Lime").disabled).toBe(true);
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  act(() => checkboxes[1].click());
  await settle();
  expect(button("安装此版本 Lime").disabled).toBe(false);
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: true,
    phase: "preparing",
    operationId: "original",
  });
  await click("安装此版本 Lime");
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "installRuntime",
      source: "release",
      resource,
      trustArtifact: true,
      createDesktopUser: true,
      installSystemPackages: true,
      confirmation: "installRuntime:cn-test:i-test",
    },
  });
  expect(prepareConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "prepareEcsConnection",
      resource,
      confirmation: "prepareEcsConnection:cn-test:i-test",
    }),
  );
  expect(document.body.textContent).toContain("正在准备 Linux 桌面依赖");
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(button("继续原操作").disabled).toBe(true);
  expect(button("关闭").disabled).toBe(false);
  await click("关闭");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each([
  ["downloading", "云端正在下载并校验运行包"],
  ["installing", "正在安装运行环境并启动桌面服务"],
])(
  "shows the actual %s phase while allowing the user to close the panel",
  async (phase, text) => {
    invoke.mockResolvedValue({
      kind: "installation",
      available: true,
      exists: true,
      busy: true,
      phase,
      operationId: "original",
      createdAt: Date.now(),
    });
    act(() =>
      root.render(<CloudRuntimeInstallation resource={resource} running />),
    );
    await settle();
    await click("安装运行环境");
    expect(document.body.textContent).toContain(text);
    expect(
      document.querySelector('[aria-current="step"]')?.textContent,
    ).toContain("获取并安装运行包");
    expect(button("继续原操作").disabled).toBe(true);
    expect(button("关闭").disabled).toBe(false);
    expect(prepareConnection).not.toHaveBeenCalled();
    await click("关闭");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("waits for connection authorization before starting installation and hides raw setup errors", async () => {
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
  await click("安装运行环境");
  act(() =>
    [...document.querySelectorAll<HTMLInputElement>("label > input")]
      .find((input) => !input.closest("details"))!
      .click(),
  );
  await settle();
  let fail!: (error: Error) => void;
  prepareConnection.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await click("安装此版本 Lime");
  expect(document.body.textContent).toContain("正在自动配置连接");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(button("安装此版本 Lime").disabled).toBe(true);
  await act(async () => fail(new Error("private-supplier-token")));
  await settle();
  expect(document.body.textContent).toContain("安装还未开始");
  expect(document.body.textContent).not.toContain("private-supplier-token");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(button("安装此版本 Lime").disabled).toBe(false);
});

it("announces release lookup, prevents duplicate submission, and restores retry after failure", async () => {
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
  await click("安装运行环境");
  act(() =>
    [...document.querySelectorAll<HTMLInputElement>("label > input")]
      .find((input) => !input.closest("details"))!
      .click(),
  );
  await settle();
  let reject!: (error: Error) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await click("安装此版本 Lime");
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "正在获取此版本的云端运行包信息",
  );
  expect(button("安装此版本 Lime").disabled).toBe(true);
  await click("安装此版本 Lime");
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE")));
  await settle();
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(button("安装此版本 Lime").disabled).toBe(false);
});

it("explains how to recover a large local package without leaking the underlying error", async () => {
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
  await click("安装运行环境");
  act(() => document.querySelector<HTMLInputElement>("details input")!.click());
  await settle();
  expect(button("选择安装文件").disabled).toBe(true);
  act(() => {
    for (const checkbox of document.querySelectorAll<HTMLInputElement>(
      'label > input[type="checkbox"]',
    ))
      if (!checkbox.closest("details")) checkbox.click();
  });
  await settle();
  invoke.mockRejectedValue(new Error("CLOUD_INSTALL_DOWNLOAD_REQUIRED"));
  await click("选择安装文件");
  const alert = document.querySelector('[role="alert"]')?.textContent;
  expect(alert).toContain("HTTPS 下载地址和可信摘要");
  expect(alert).toContain(".tar.gz.json");
  expect(alert).not.toContain("CLOUD_INSTALL_DOWNLOAD_REQUIRED");
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(button("选择安装文件").disabled).toBe(false);
  expect(invoke.mock.lastCall?.[1].request.source).toBe("file");
});

it("explains an unpublished release and keeps the explicit retry available", async () => {
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
  await click("安装运行环境");
  act(() =>
    document
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
      .click(),
  );
  await settle();
  invoke.mockRejectedValue(Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE"));
  await click("安装此版本 Lime");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "此版本尚未提供可用的云端运行包",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(
    "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
  );
  expect(button("安装此版本 Lime").disabled).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("explains preparation failure without presenting it as a runtime installation", async () => {
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: false,
    phase: "failed",
    diagnostic: "CLOUD_INSTALL_PREPARATION_FAILED",
    operationId: "original",
    connectionSaved: false,
  });
  act(() =>
    root.render(<CloudRuntimeInstallation resource={resource} running />),
  );
  await settle();
  await click("安装运行环境");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "桌面依赖准备未完成，运行包尚未启动",
  );
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cloud_desktop_connection", {
    request: { action: "installationStatus", resource },
  });
});

it("explains supplier security-group denial and keeps the original operation resumable", async () => {
  invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: false,
    phase: "needsAttention",
    operationId: "original",
    diagnostic: "CLOUD_INSTALL_SECURITY_GROUP_DENIED",
  });
  act(() =>
    root.render(<CloudRuntimeInstallation resource={resource} running />),
  );
  await settle();
  await click("安装运行环境");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "阿里云安全组阻止了会话转发",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "授权后，Lime 会配置专用网络",
  );
  expect(button("继续原操作").disabled).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(prepareConnection).not.toHaveBeenCalled();
  act(() =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await settle();
  await click("继续原操作");
  expect(prepareConnection).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "resumeInstallation",
      resource,
      operationId: "original",
    },
  });
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
  await click("继续原操作");
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

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "guides pending delivery recovery before forgetting or rotating the connection in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    const text = (key: string) =>
      String(getLimeI18n().t(`settings:settings.cloudDesktop.${key}`));
    invoke.mockResolvedValue({
      kind: "installation",
      available: true,
      exists: true,
      busy: false,
      phase: "complete",
      connectionSaved: true,
      operationId: "installation-original",
    });
    act(() =>
      root.render(
        <CloudRuntimeInstallation resource={resource} running reconnect />,
      ),
    );
    await settle();
    await click(text("taskConnection"));
    invoke.mockRejectedValue(
      new Error("CLOUD_MODEL_CONNECTION_UNRESOLVED private-detail"),
    );
    await click(text("forgetConnection"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      text("modelShareResolveFirst"),
    );
    expect(document.body.textContent).not.toContain("private-detail");
    expect(document.body.textContent).not.toContain("settings.cloudDesktop");
    expect(document.querySelector("summary")?.textContent).toContain(
      text("modelShareTitle"),
    );
    act(() =>
      document
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
    await click(text("reconnectRuntime"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      text("modelShareResolveFirst"),
    );
    expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
      request: {
        action: "reconnectRuntime",
        resource,
        confirmation: `reconnectRuntime:${resource.regionId}:${resource.resourceId}`,
        workSaved: true,
      },
    });
  },
);
