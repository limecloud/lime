import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { useCloudDesktopSetup } from "./useCloudDesktopSetup";

const api = vi.hoisted(() => ({ cloud: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.cloud }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: api.connection,
}));

const first: CloudDesktopResource = {
  provider: "ecs",
  regionId: "cn-test",
  profile: "user",
  resourceId: "i-first",
};
const second = { ...first, resourceId: "i-second" };
let root: Root;
let container: HTMLDivElement;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Harness({ resource }: { resource?: CloudDesktopResource }) {
  const { refresh, ...state } = useCloudDesktopSetup(resource);
  return (
    <>
      <pre>{JSON.stringify(state)}</pre>
      <button onClick={() => void refresh()}>Refresh</button>
    </>
  );
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
}

async function render(resource?: CloudDesktopResource) {
  act(() => root.render(<Harness resource={resource} />));
  await settle();
}

function state() {
  return JSON.parse(container.querySelector("pre")!.textContent!);
}

async function refresh() {
  act(() => container.querySelector("button")!.click());
  await settle();
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.cloud.mockReset();
  api.connection.mockReset();
  api.cloud.mockImplementation(async ({ action, resource }) => ({
    data:
      action === "listResources"
        ? { resources: [first, second] }
        : { name: resource.resourceId, status: "Running" },
  }));
  api.connection.mockResolvedValue({ connectionSaved: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("目标模式不请求无关云机，已购目标不等待其检查", async () => {
  const unrelated = deferred<{ data: { status: string } }>();
  api.cloud.mockImplementation(async ({ action, resource }) => {
    if (action === "listResources") return { data: { resources: [second] } };
    if (resource.resourceId === second.resourceId) return unrelated.promise;
    return { data: { name: "已购买目标", status: "Running" } };
  });
  await render(first);
  expect(state()).toMatchObject({
    loading: false,
    failed: false,
    computers: [{ resource: first, name: "已购买目标", connectionSaved: true }],
  });
  expect(api.cloud.mock.calls.map(([request]) => request.action)).toEqual([
    "listResources",
    "inspect",
  ]);
  expect(api.cloud.mock.calls[1][0].resource).toEqual(first);
  expect(api.connection).toHaveBeenCalledTimes(1);
  expect(api.connection.mock.calls[0][0].resource).toEqual(first);
});

it("一台检查挂起时另一台立即可用，随后按原清单顺序显示", async () => {
  const slow = deferred<{ data: { name: string; status: string } }>();
  api.cloud.mockImplementation(async ({ action, resource }) => {
    if (action === "listResources")
      return { data: { resources: [first, second] } };
    if (resource.resourceId === first.resourceId) return slow.promise;
    return { data: { name: "快速电脑", status: "Running" } };
  });
  await render();
  expect(state()).toMatchObject({
    loading: true,
    failed: false,
    computers: [
      { resource: second, connectionSaved: true, inspectionFailed: false },
    ],
  });
  slow.resolve({ data: { name: "慢速电脑", status: "Stopped" } });
  await settle();
  expect(state()).toMatchObject({
    loading: false,
    computers: [{ resource: first }, { resource: second }],
  });
});

it("刷新期间保留其他旧行，已完成行立即更新且无重复", async () => {
  await render();
  const slow = deferred<{ data: { name: string; status: string } }>();
  api.cloud.mockImplementation(async ({ action, resource }) => {
    if (action === "listResources")
      return { data: { resources: [first, second] } };
    if (resource.resourceId === first.resourceId) return slow.promise;
    return { data: { name: "新状态", status: "Stopped" } };
  });
  await refresh();
  expect(state()).toMatchObject({
    loading: true,
    computers: [
      { resource: first, name: first.resourceId },
      { resource: second, name: "新状态", status: "Stopped" },
    ],
  });
  slow.resolve({ data: { name: "首台新状态", status: "Stopped" } });
  await settle();
  expect(state()).toMatchObject({
    loading: false,
    computers: [
      { resource: first, name: "首台新状态" },
      { resource: second, name: "新状态" },
    ],
  });
});

it("切换目标后旧结果不能混入新目标或解除释放保护", async () => {
  const old = deferred<{ data: { status: string } }>();
  api.cloud.mockImplementation(async ({ action, resource }) => {
    if (action === "listResources")
      return { data: { resources: [first, second] } };
    if (resource.resourceId === first.resourceId) return old.promise;
    return {
      data: { status: "Running", autoReleaseTime: "2099-01-01T00:00:00Z" },
    };
  });
  await render(first);
  await render(second);
  expect(state()).toMatchObject({
    loading: false,
    computers: [{ resource: second, releasePending: true }],
  });
  old.resolve({ data: { status: "Running" } });
  await settle();
  expect(state().computers).toHaveLength(1);
  expect(state().computers[0]).toMatchObject({
    resource: second,
    releasePending: true,
  });
});

it("较旧刷新不能覆盖新一轮结果或其加载终态", async () => {
  const old = deferred<{ data: { status: string } }>();
  let inspections = 0;
  api.cloud.mockImplementation(async ({ action }) => {
    if (action === "listResources") return { data: { resources: [first] } };
    if (++inspections === 1) return old.promise;
    return { data: { name: "当前结果", status: "Stopped" } };
  });
  await render();
  await refresh();
  old.resolve({ data: { status: "Running" } });
  await settle();
  expect(state()).toMatchObject({
    loading: false,
    failed: false,
    computers: [{ resource: first, name: "当前结果", status: "Stopped" }],
  });
});

it("卸载后的清单响应不再触发云机检查或本机连接读取", async () => {
  const list = deferred<{ data: { resources: CloudDesktopResource[] } }>();
  api.cloud.mockReturnValue(list.promise);
  await render();
  act(() => root.render(null));
  list.resolve({ data: { resources: [first, second] } });
  await settle();
  expect(api.cloud).toHaveBeenCalledTimes(1);
  expect(api.connection).not.toHaveBeenCalled();
});
