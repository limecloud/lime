import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudWindowBoundary } from "./CloudWindowBoundary";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  reconnect: vi.fn(),
  bridge: vi.fn(),
  view: vi.fn(),
  password: vi.fn(),
}));
vi.mock("@/lib/electron-host", () => ({ getElectronHostBridge: api.bridge }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  readCloudDesktopWindowStatus: api.status,
  reconnectCloudDesktopWindow: api.reconnect,
  connectCloudDesktopView: api.view,
  showCloudDesktopViewPassword: api.password,
}));
const context = {
  kind: "cloud",
  endpoint: "ws://127.0.0.1:8787/",
  resource: {
    provider: "ecs",
    profile: "owned",
    regionId: "cn-test",
    resourceId: "i-test",
  },
};
let root: Root;
let container: HTMLDivElement;
let reload: ReturnType<typeof vi.fn>;
const originalWindow = window;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render() {
  await act(async () => {
    root.render(
      <CloudWindowBoundary>
        <button data-testid="old-task">Old approval</button>
      </CloudWindowBoundary>,
    );
  });
}
async function click() {
  const button = container.querySelector<HTMLButtonElement>("button");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  reload = vi.fn();
  vi.stubGlobal(
    "window",
    Object.create(originalWindow, { location: { value: { reload } } }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.bridge.mockReturnValue({ cloudDesktop: context });
  api.status
    .mockReset()
    .mockResolvedValue({ ...context, connected: false, generation: 1 });
  api.reconnect.mockReset();
  api.view.mockReset();
  api.password.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("本机窗口直接渲染任务，不读取云连接", async () => {
  api.bridge.mockReturnValue(undefined);
  await render();
  expect(container.querySelector("[data-testid=old-task]")).not.toBeNull();
  expect(api.status).not.toHaveBeenCalled();
});

it("云窗口默认收起桌面，只有用户点击后才请求查看连接", async () => {
  await render();
  expect(container.querySelector("iframe")).toBeNull();
  expect(api.view).not.toHaveBeenCalled();
  const view = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("查看桌面"),
  );
  expect(view).toBeTruthy();
  api.view.mockReturnValue(new Promise(() => undefined));
  await act(async () => view!.click());
  expect(api.view).toHaveBeenCalledTimes(1);
  expect(container.querySelector("iframe")).toBeNull();
});

it("首次连接成功才挂载任务，后续状态查询失败时隔离任务", async () => {
  const pending = deferred<unknown>();
  api.status.mockReturnValueOnce(pending.promise);
  await render();
  expect(container.textContent).toContain("正在连接云电脑");
  expect(container.querySelector("[data-testid=old-task]")).toBeNull();
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("重新连接"),
    ),
  ).toBe(false);
  await act(async () => pending.resolve({ ...context, connected: true }));
  expect(container.querySelector("[data-testid=old-task]")).not.toBeNull();
  api.status.mockRejectedValue(new Error("offline"));
  await poll();
  expect(container.querySelector("[data-testid=old-task]")).toBeNull();
  expect(container.querySelector("button")?.disabled).toBe(false);
});

it("重连中的轮询成功不能重新挂载旧审批，成功后保持隔离直到刷新", async () => {
  const pending = deferred<unknown>();
  api.reconnect.mockReturnValue(pending.promise);
  await render();
  await click();
  api.status.mockResolvedValue({ ...context, connected: true, generation: 2 });
  await poll();
  expect(container.querySelector("[data-testid=old-task]")).toBeNull();
  expect(container.textContent).toContain("正在连接云电脑");
  expect(container.querySelector("button")?.disabled).toBe(true);
  await click();
  expect(api.reconnect).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({ ...context, connected: true, generation: 2 }),
  );
  expect(reload).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-testid=old-task]")).toBeNull();
  expect(container.querySelector("button")?.disabled).toBe(true);
});

it("重连返回未连接时不刷新，保留明确重试入口", async () => {
  api.reconnect.mockResolvedValue({
    ...context,
    connected: false,
    generation: 2,
  });
  await render();
  await click();
  expect(reload).not.toHaveBeenCalled();
  expect(container.querySelector("[role=alert]")).not.toBeNull();
  expect(container.querySelector("button")?.disabled).toBe(false);
  expect(container.querySelector("[data-testid=old-task]")).toBeNull();
});

it("重连失败后迟到的 connected 轮询不恢复旧任务，显式重试清除错误", async () => {
  api.reconnect.mockRejectedValueOnce(new Error("ECS_SECURITY_GROUP_DENIED"));
  await render();
  await click();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "安全组",
  );
  api.status.mockResolvedValue({ ...context, connected: true, generation: 2 });
  await poll();
  expect(container.querySelector("[data-testid=old-task]")).toBeNull();
  expect(container.querySelector("button")?.disabled).toBe(false);
  api.reconnect.mockReturnValue(new Promise(() => undefined));
  await click();
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(api.reconnect).toHaveBeenCalledTimes(2);
});

it("重连错误不将任意服务端消息或签名地址显示给用户", async () => {
  api.reconnect.mockRejectedValue(
    new Error("https://supplier.invalid/?token=private-value"),
  );
  await render();
  await click();
  expect(container.querySelector("[role=alert]")).not.toBeNull();
  expect(container.textContent).not.toContain("private-value");
  expect(container.textContent).not.toContain("supplier.invalid");
});

it("任务隧道失败提供现役恢复提示并保留重试", async () => {
  api.reconnect.mockRejectedValue(new Error("ECS_TUNNEL_FAILED"));
  await render();
  await click();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "无法建立任务通道",
  );
  expect(container.textContent).not.toContain("ECS_TUNNEL_FAILED");
  expect(container.querySelector("button")?.disabled).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it("组件卸载后的重连成功不刷新后续页面", async () => {
  const pending = deferred<unknown>();
  api.reconnect.mockReturnValue(pending.promise);
  await render();
  await click();
  act(() => root.render(<p>Next page</p>));
  await act(async () =>
    pending.resolve({ ...context, connected: true, generation: 2 }),
  );
  expect(reload).not.toHaveBeenCalled();
  expect(container.textContent).toBe("Next page");
});

it("上下文切换使原重连失效，不刷新或覆盖本机任务", async () => {
  const pending = deferred<unknown>();
  api.reconnect.mockReturnValue(pending.promise);
  await render();
  await click();
  api.bridge.mockReturnValue(undefined);
  await render();
  expect(container.querySelector("[data-testid=old-task]")).not.toBeNull();
  await act(async () => pending.resolve({ ...context, connected: true }));
  expect(reload).not.toHaveBeenCalled();
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(container.querySelector("[data-testid=old-task]")).not.toBeNull();
});
