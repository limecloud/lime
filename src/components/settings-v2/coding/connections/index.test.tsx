import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ConnectionsSettings } from ".";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  ensure: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
  grants: vi.fn(),
}));

vi.mock("@/lib/api/sshConnections", () => ({
  ensureSshConfig: api.ensure,
  listSshConnections: api.list,
  removeSshConnection: api.remove,
  updateSshConnection: api.update,
}));
vi.mock("@/lib/api/openIn", () => ({
  openIn: { open: api.open },
}));
vi.mock("@/lib/api/connections", () => ({
  listConnectionGrants: api.grants,
}));

let root: Root;
let container: HTMLDivElement;

async function mount() {
  await act(async () => root.render(<ConnectionsSettings />));
  await act(async () => Promise.resolve());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
  api.ensure.mockResolvedValue("/Users/test/.ssh/config");
  api.open.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(true);
  api.grants.mockResolvedValue([]);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ConnectionsSettings", () => {
  it("列出 SSH 连接与 user@host:port", async () => {
    api.list.mockResolvedValue([
      { alias: "prod", hostName: "10.0.0.1", user: "deploy", port: 2222 },
      { alias: "dev", hostName: "dev.example.com", user: null, port: null },
    ]);
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("来自这台 Mac 的 SSH 连接");
    expect(text).toContain("通过 SSH 连接到远程设备");
    expect(text).toContain("prod");
    expect(text).toContain("deploy@10.0.0.1:2222");
    expect(text).toContain("dev.example.com");
  });

  it("无 SSH 连接时展示空态", async () => {
    await mount();
    expect(container.textContent).toContain("暂无 SSH 连接");
  });

  it("加载失败可重试", async () => {
    api.list.mockRejectedValueOnce(new Error("boom"));
    await mount();
    expect(container.textContent).toContain("无法读取 SSH 连接");
    api.list.mockResolvedValue([
      { alias: "prod", hostName: "10.0.0.1", user: null, port: null },
    ]);
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "重试",
    )!;
    await act(async () => retry.click());
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("10.0.0.1");
  });

  it("点击编辑打开预填的连接表单", async () => {
    api.list.mockResolvedValue([
      { alias: "prod", hostName: "10.0.0.1", user: "deploy", port: 22 },
    ]);
    await mount();
    const edit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "编辑",
    )!;
    await act(async () => edit.click());
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("编辑 SSH 连接");
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>(
        "[data-testid=ssh-connection-dialog] input",
      ),
    ];
    expect(inputs.map((input) => input.value)).toEqual([
      "prod",
      "10.0.0.1",
      "deploy",
      "22",
    ]);
  });

  it("打开配置时确保并打开 ~/.ssh/config", async () => {
    await mount();
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开配置",
    )!;
    await act(async () => open.click());
    await act(async () => Promise.resolve());
    expect(api.ensure).toHaveBeenCalled();
    expect(api.open).toHaveBeenCalledWith({
      target: "systemDefault",
      path: "/Users/test/.ssh/config",
      openMode: "file",
    });
  });

  it("打开配置失败时提示", async () => {
    api.open.mockRejectedValueOnce(new Error("missing"));
    await mount();
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开配置",
    )!;
    await act(async () => open.click());
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("无法打开 SSH 配置");
  });

  it("移除连接需确认后调用删除并刷新列表", async () => {
    api.list.mockResolvedValue([
      { alias: "prod", hostName: "10.0.0.1", user: null, port: null },
    ]);
    await mount();
    const rowRemove = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "移除",
    )!;
    await act(async () => rowRemove.click());
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("移除 SSH 连接？");

    const dialog = document.querySelector('[role="dialog"]')!;
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "移除",
    )!;
    await act(async () => confirm.click());
    await act(async () => Promise.resolve());
    expect(api.remove).toHaveBeenCalledWith("prod");
  });

  it("点击添加打开 SSH 连接表单", async () => {
    await mount();
    const add = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "添加",
    )!;
    await act(async () => add.click());
    await act(async () => Promise.resolve());
    expect(
      document.querySelector("[data-testid=ssh-connection-dialog]"),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("添加 SSH 连接");
  });
});

const grant = {
  id: "icg_original",
  connectionId: "icn_original",
  connectionRevision: 2,
  applicationId: "app_lime",
  applicationName: "Lime",
  actions: ["drive.files.read"],
  fileCount: 2,
  status: "active",
  revision: 1,
  expiresAt: "2026-11-13T08:00:00Z",
};

describe("ConnectionsSettings application grants", () => {
  it("列出当前应用连接、文件数与到期时间", async () => {
    api.grants.mockResolvedValue([grant]);
    await mount();
    const text = container.textContent ?? "";
    expect(api.grants).toHaveBeenCalled();
    expect(text).toContain("应用连接");
    expect(text).toContain("Lime");
    expect(text).toContain("2 个文件");
    expect(text).toContain("有效");
    expect(text).toContain("2026");
    expect(
      container.querySelector(
        '[data-testid="settings-connections-grants-empty"]',
      ),
    ).toBeNull();
  });

  it("无应用连接时展示空态", async () => {
    await mount();
    expect(
      container.querySelector(
        '[data-testid="settings-connections-grants-empty"]',
      )?.textContent,
    ).toContain("暂无应用连接");
  });

  it("应用连接加载失败时提示并可按原入口重试", async () => {
    api.grants.mockRejectedValueOnce(new Error("boom"));
    await mount();
    const alert = container.querySelector(
      '[data-testid="settings-connections-grants-error"]',
    )!;
    expect(alert.textContent).toContain("无法读取应用连接");
    api.grants.mockResolvedValue([grant]);
    const retry = [...alert.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "重试",
    )!;
    await act(async () => retry.click());
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Lime");
  });

  it("应用连接加载中显示独立状态", async () => {
    let finish!: (value: unknown[]) => void;
    api.grants.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    const loading = container.querySelector(
      '[data-testid="settings-connections-grants-loading"]',
    );
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-busy")).toBe("true");
    await act(async () => finish([]));
    await act(async () => Promise.resolve());
    expect(
      container.querySelector(
        '[data-testid="settings-connections-grants-loading"]',
      ),
    ).toBeNull();
  });
});
