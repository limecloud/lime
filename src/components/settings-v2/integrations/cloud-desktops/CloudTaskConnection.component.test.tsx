import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudTaskConnection } from "./CloudTaskConnection";
import { CloudDesktopTunnel } from "./CloudDesktopTunnel";
import { CloudWindowBoundary } from "@/components/cloud/CloudWindowBoundary";

let root: Root;
let container: HTMLDivElement;
const invoke = vi.fn();
const resource = {
  provider: "wuying" as const,
  profile: "test",
  regionId: "cn-test",
  resourceId: "ecd-test",
};
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function button(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((element) => element.textContent?.trim() === label);
  expect(found, label).toBeTruthy();
  return found!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
async function fill(label: string, value: string) {
  const input = [...document.querySelectorAll("label")]
    .find((element) => element.querySelector("span")?.textContent === label)
    ?.querySelector("input");
  expect(input).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  vi.useRealTimers();
});

describe("temporary ECS desktop tunnel", () => {
  const ecs = { ...resource, provider: "ecs" as const, resourceId: "i-test" };
  const closed = {
    data: { state: "closed", channel: "desktop", persistent: false },
  };
  const listening = {
    data: {
      state: "listening",
      channel: "desktop",
      endpoint: "http://127.0.0.1:12345/vnc.html",
      persistent: false,
    },
  };

  it("requires an explicit start, deduplicates clicks and keeps the tunnel when its dialog closes", async () => {
    const request = vi.fn().mockResolvedValue(closed);
    act(() =>
      root.render(
        <CloudDesktopTunnel resource={ecs} running request={request} />,
      ),
    );
    await settle();
    expect(request).not.toHaveBeenCalled();
    await click("桌面连接");
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "readEcsTunnel",
      resource: ecs,
      channel: "desktop",
    });
    let complete: (value: unknown) => void = () => undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => {
      button("建立通道").click();
      button("建立通道").click();
    });
    await settle();
    expect(
      request.mock.calls.filter(
        ([params]) => params.action === "openEcsTunnel",
      ),
    ).toHaveLength(1);
    act(() => complete(listening));
    await settle();
    expect(button("打开桌面").disabled).toBe(false);
    invoke.mockResolvedValue(undefined);
    await click("打开桌面");
    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: listening.data.endpoint,
    });
    await click("关闭");
    expect(
      request.mock.calls.filter(
        ([params]) => params.action === "closeEcsTunnel",
      ),
    ).toHaveLength(0);
    request.mockResolvedValue(listening);
    await click("桌面连接");
    request.mockResolvedValueOnce(closed);
    await click("断开通道");
    expect(request).toHaveBeenLastCalledWith({
      action: "closeEcsTunnel",
      resource: ecs,
      channel: "desktop",
    });
    expect(button("建立通道").disabled).toBe(false);
  });

  it("rejects a non-loopback endpoint and disables unavailable computers", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        ...listening.data,
        endpoint: "https://untrusted.test/vnc.html?token=secret",
      },
    });
    act(() =>
      root.render(
        <CloudDesktopTunnel resource={ecs} running request={request} />,
      ),
    );
    await settle();
    await click("桌面连接");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("untrusted.test");
    expect(
      [...document.querySelectorAll("button")].some(
        (node) => node.textContent === "打开桌面",
      ),
    ).toBe(false);
    await click("关闭");
    act(() =>
      root.render(
        <CloudDesktopTunnel resource={ecs} running={false} request={request} />,
      ),
    );
    await settle();
    expect(button("桌面连接").disabled).toBe(true);
  });

  it("explains supplier security group denial without retrying or changing cloud rules", async () => {
    const request = vi.fn().mockResolvedValue(closed);
    act(() =>
      root.render(
        <CloudDesktopTunnel resource={ecs} running request={request} />,
      ),
    );
    await settle();
    await click("桌面连接");
    request.mockRejectedValueOnce(
      new Error(
        "Cloud request failed (ErrorCode=InvalidOperation.SecurityGroupRuleDenied)",
      ),
    );
    await click("建立通道");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "阿里云安全组阻止了会话转发",
    );
    expect(button("建立通道").disabled).toBe(false);
    expect(request.mock.calls.map(([params]) => params.action)).toEqual([
      "readEcsTunnel",
      "openEcsTunnel",
    ]);
  });

  it("observes an expired listener without automatically starting another supplier session", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(listening);
    act(() =>
      root.render(
        <CloudDesktopTunnel resource={ecs} running request={request} />,
      ),
    );
    await settle();
    await click("桌面连接");
    request.mockResolvedValue(closed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await settle();
    expect(button("建立通道").disabled).toBe(false);
    expect(
      request.mock.calls.every(([params]) => params.action === "readEcsTunnel"),
    ).toBe(true);
  });
});

describe("cloud task connection", () => {
  const ecs = { ...resource, provider: "ecs" as const, resourceId: "i-test" };

  it("rebuilds an ECS connection with explicit saved-work consent and no token or artifact input", async () => {
    invoke.mockResolvedValue({
      kind: "installation",
      available: true,
      exists: false,
      busy: false,
    });
    act(() => root.render(<CloudTaskConnection resource={ecs} running />));
    await settle();
    await click("任务连接");
    expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
      request: { action: "installationStatus", resource: ecs },
    });
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('input[type="url"]')).toBeNull();
    expect(button("重建连接").disabled).toBe(true);
    const consent = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    act(() => consent.click());
    await settle();
    let resolve: (value: unknown) => void = () => undefined;
    invoke.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => {
      button("重建连接").click();
      button("重建连接").click();
    });
    await settle();
    expect(
      invoke.mock.calls.filter(
        ([, args]) => args.request.action === "reconnectRuntime",
      ),
    ).toHaveLength(1);
    expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
      request: {
        action: "reconnectRuntime",
        resource: ecs,
        confirmation: "reconnectRuntime:cn-test:i-test",
        workSaved: true,
      },
    });
    act(() =>
      resolve({
        kind: "installation",
        available: true,
        exists: true,
        busy: false,
        mode: "reconnect",
        phase: "complete",
        connectionSaved: true,
      }),
    );
    await settle();
    expect(button("打开云窗口").disabled).toBe(false);
    expect(
      invoke.mock.calls.some(([, args]) => args.request.action === "open"),
    ).toBe(false);
    invoke.mockRejectedValueOnce(new Error("ECS_SECURITY_GROUP_DENIED"));
    await click("打开云窗口");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "阿里云安全组阻止了会话转发",
    );
  });

  it("resumes the existing ECS reconnect operation without requesting another rotation", async () => {
    invoke.mockResolvedValue({
      kind: "installation",
      available: true,
      exists: true,
      busy: false,
      mode: "reconnect",
      phase: "needsAttention",
      operationId: "original-reset",
      connectionSaved: false,
    });
    act(() => root.render(<CloudTaskConnection resource={ecs} running />));
    await settle();
    await click("任务连接");
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    await click("继续原操作");
    expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
      request: {
        action: "resumeInstallation",
        resource: ecs,
        operationId: "original-reset",
      },
    });
    expect(
      invoke.mock.calls.some(
        ([, args]) => args.request.action === "reconnectRuntime",
      ),
    ).toBe(false);
  });

  it("clears connection state when the resource changes and ignores the old pending response", async () => {
    let finishOld: (value: unknown) => void = () => undefined;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    act(() => root.render(<CloudTaskConnection resource={ecs} running />));
    await settle();
    await click("任务连接");
    const next = { ...ecs, resourceId: "i-other" };
    act(() => root.render(<CloudTaskConnection resource={next} running />));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    invoke.mockResolvedValue({
      kind: "installation",
      available: true,
      exists: false,
      busy: false,
    });
    await click("任务连接");
    expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
      request: { action: "installationStatus", resource: next },
    });
    act(() =>
      finishOld({
        kind: "installation",
        available: true,
        exists: true,
        busy: false,
        phase: "complete",
        connectionSaved: true,
      }),
    );
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "i-other",
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("任务连接已保存");
    expect(button("重建连接").disabled).toBe(true);
    act(() =>
      document
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
    await click("重建连接");
    expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
      request: {
        action: "reconnectRuntime",
        resource: next,
        confirmation: "reconnectRuntime:cn-test:i-other",
        workSaved: true,
      },
    });
  });

  it("keeps the token blank, blocks unsaved address changes, saves once and clears secrets on close", async () => {
    invoke.mockResolvedValue({
      exists: true,
      available: true,
      endpoint: "wss://cloud.test/rpc",
    });
    act(() => root.render(<CloudTaskConnection resource={resource} running />));
    await settle();
    await click("任务连接");
    expect(
      (document.querySelector('input[type="password"]') as HTMLInputElement)
        .value,
    ).toBe("");
    expect(button("打开云窗口").disabled).toBe(false);
    await fill("服务器地址", "wss://other.test/rpc");
    expect(button("打开云窗口").disabled).toBe(true);
    await fill("连接令牌", "fixture-private-token");
    let resolve: (value: unknown) => void = () => undefined;
    invoke.mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    act(() => {
      button("保存连接").click();
      button("保存连接").click();
    });
    await settle();
    expect(
      invoke.mock.calls.filter(([, args]) => args?.request?.action === "save"),
    ).toHaveLength(1);
    act(() =>
      resolve({
        exists: true,
        available: true,
        endpoint: "wss://other.test/rpc",
      }),
    );
    await settle();
    expect(
      (document.querySelector('input[type="password"]') as HTMLInputElement)
        .value,
    ).toBe("");
    expect(button("打开云窗口").disabled).toBe(false);
    await fill("连接令牌", "unsaved-token");
    await click("关闭");
    await click("任务连接");
    expect(
      (document.querySelector('input[type="password"]') as HTMLInputElement)
        .value,
    ).toBe("");
    expect(document.body.textContent).not.toContain("fixture-private-token");
  });

  it("shows unavailable secure storage and never offers a plaintext fallback", async () => {
    invoke.mockResolvedValue({ exists: false, available: false });
    act(() => root.render(<CloudTaskConnection resource={resource} running />));
    await settle();
    await click("任务连接");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "系统安全存储不可用",
    );
    expect(button("保存连接").disabled).toBe(true);
    expect(button("打开云窗口").disabled).toBe(true);
  });

  it("keeps the remote application unmounted after a disconnect and reports failed reconnection", async () => {
    vi.useFakeTimers();
    window.electronAPI = {
      ...window.electronAPI!,
      cloudDesktop: {
        kind: "cloud",
        resource,
        endpoint: "wss://cloud.test/rpc",
      },
    };
    invoke.mockResolvedValue({ connected: true, generation: 1 });
    act(() =>
      root.render(
        <CloudWindowBoundary>
          <span data-testid="cloud-content">cloud content</span>
        </CloudWindowBoundary>,
      ),
    );
    await settle();
    expect(
      document.querySelector('[data-testid="cloud-content"]'),
    ).not.toBeNull();
    invoke.mockResolvedValue({ connected: false, generation: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await settle();
    expect(document.querySelector('[data-testid="cloud-content"]')).toBeNull();
    invoke.mockRejectedValue(new Error("fixture authentication refused"));
    await click("重新连接");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "未能重新连接云电脑",
    );
    expect(document.body.textContent).not.toContain(
      "fixture authentication refused",
    );
    expect(invoke).toHaveBeenCalledWith("cloud_desktop_window_reconnect");
    expect(document.querySelector('[data-testid="cloud-content"]')).toBeNull();
  });
});
