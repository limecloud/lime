import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import CloudDesktopSetupDialog from "./CloudDesktopSetupDialog";
import { initialEcsSpec } from "@/components/settings-v2/integrations/cloud-desktops/purchaseSpecs";
import { purchaseNetworkProof } from "@/components/settings-v2/integrations/cloud-desktops/cloudPurchase.testFixtures";

const api = vi.hoisted(() => ({ cloud: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.cloud }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: api.connection,
}));
const resource = {
  provider: "ecs",
  regionId: "cn-test",
  profile: "user",
  resourceId: "i-test",
};
let root: Root;
let container: HTMLDivElement;
let close: ReturnType<typeof vi.fn<() => void>>;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function button(text: string) {
  const value = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent === text);
  expect(value, text).toBeTruthy();
  return value!;
}
async function click(text: string) {
  await act(async () => button(text).click());
  await settle();
}
async function render() {
  act(() => root.render(<CloudDesktopSetupDialog onClose={close} />));
  await settle();
}
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  close = vi.fn<() => void>();
  api.cloud.mockReset();
  api.connection.mockReset();
  api.cloud.mockImplementation(async (request) => ({
    data:
      request.action === "listResources"
        ? { resources: [resource] }
        : { name: "开发电脑", status: "Running" },
  }));
  api.connection.mockImplementation(async (request) =>
    request.action === "prepareRuntimeRelease"
      ? {
          kind: "guestPreparation",
          phase: "ready",
          busy: false,
          version: "test",
        }
      : {
          kind: "installation",
          available: true,
          exists: false,
          busy: false,
          connectionSaved: false,
        },
  );
  window.electronAPI = {
    invoke: vi.fn(),
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

it("有释放期限或未决回收时引导去管理页，不开放启动、连接和安装", async () => {
  for (const status of ["Stopped", "Running"]) {
    api.cloud.mockImplementation(async (request) => ({
      data:
        request.action === "listResources"
          ? { resources: [resource] }
          : {
              name: "开发电脑",
              status,
              autoReleaseTime: "2099-01-01T00:00:00Z",
            },
    }));
    await render();
    await click("刷新状态");
    expect(document.body.textContent).toContain("再次使用前须撤销并确认");
    expect(document.body.textContent).toContain("释放时间");
    const labels = [...document.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    expect(labels).not.toContain("启动");
    expect(labels).not.toContain("打开云端窗口");
    expect(labels).not.toContain("首次安装");
    expect(
      api.connection.mock.calls.every(([request]) => request.action !== "open"),
    ).toBe(true);
  }
});

it("空态仍可购买，并提前说明耗时、费用及本机草稿边界", async () => {
  api.cloud.mockResolvedValue({ data: { resources: [] } });
  await render();
  expect(document.body.textContent).toContain("数十分钟");
  expect(document.body.textContent).toContain("本机草稿会保留");
  expect(document.body.textContent).toContain(
    "安装和停机保留期间也可能产生费用",
  );
  expect(document.body.textContent).toContain("还没有云电脑");
  await click("添加电脑");
  expect(
    document
      .querySelector('[role="tab"][data-state="active"]')
      ?.getAttribute("data-state"),
  ).toBe("active");
  expect(
    document.querySelector('[role="tab"][data-state="active"]')?.textContent,
  ).toBe("购买 Linux 电脑");
  expect(
    api.cloud.mock.calls.some(([request]) =>
      ["purchaseEcs", "purchaseWuying", "bind"].includes(request.action),
    ),
  ).toBe(false);
});

it("清单错误显示错误，不能冒充空态或自动购买", async () => {
  api.cloud.mockRejectedValue(new Error("sensitive internal details"));
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "状态读取失败",
  );
  expect(document.body.textContent).not.toContain("还没有云电脑");
  expect(document.body.textContent).not.toContain("sensitive internal details");
  expect(api.connection).not.toHaveBeenCalled();
});

it("部分电脑读取失败时保留其他电脑，并打开已保存连接", async () => {
  const broken = { ...resource, resourceId: "i-broken" };
  api.cloud.mockImplementation(async (request) => {
    if (request.action === "listResources")
      return { data: { resources: [resource, broken] } };
    if (request.resource.resourceId === broken.resourceId)
      throw new Error("inspect failed");
    return { data: { name: "开发电脑", status: "Running" } };
  });
  api.connection.mockResolvedValue({ connectionSaved: true });
  await render();
  expect(
    document.querySelectorAll('[data-testid="cloud-desktop-setup"] li'),
  ).toHaveLength(2);
  expect(document.body.textContent).toContain("部分状态读取失败");
  await click("打开云窗口");
  expect(api.connection).toHaveBeenLastCalledWith({ action: "open", resource });
  expect(close).toHaveBeenCalledOnce();
});

it("未安装电脑直接进入现役安装确认，不自动安装或上传", async () => {
  await render();
  await click("安装运行环境");
  expect(button("安装此版本 Lime").disabled).toBe(true);
  expect(
    document.querySelector('[data-testid="cloud-installation-progress"]')
      ?.textContent,
  ).toContain("数十分钟");
  expect(
    api.connection.mock.calls.every(
      ([request]) => request.action === "installationStatus",
    ),
  ).toBe(true);
});

it("镜像恢复或已有运行环境可直接重建连接，无需选择安装文件", async () => {
  await render();
  await click("任务连接");
  expect(document.body.textContent).toContain(
    "保留运行环境和文件，无需上传运行包或填写令牌",
  );
  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(button("重建连接").disabled).toBe(true);
  expect(
    [...document.querySelectorAll("button")].some(
      (item) => item.textContent === "选择安装文件",
    ),
  ).toBe(false);
  expect(
    api.connection.mock.calls.every(
      ([request]) => request.action === "installationStatus",
    ),
  ).toBe(true);
});

it("停机电脑复用精确资源的启动确认，unknown 只查询操作收据", async () => {
  api.cloud.mockImplementation(async (request) => ({
    data:
      request.action === "listResources"
        ? { resources: [resource] }
        : request.action === "inspect"
          ? { status: "Stopped" }
          : {
              outcome: "unknown",
              operationId: request.operationId,
              requiresInspection: true,
            },
  }));
  await render();
  expect(document.body.textContent).not.toContain("创建快照");
  await click("启动");
  const dialog = document.querySelector('[role="dialog"]:last-of-type');
  expect(dialog?.textContent).toContain(resource.resourceId);
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="i-test"]',
  );
  if (input) {
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, resource.resourceId);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent === "确认执行");
  expect(confirm).toBeTruthy();
  await act(async () => confirm!.click());
  await settle();
  const starts = api.cloud.mock.calls.filter(
    ([request]) => request.action === "start",
  );
  expect(starts).toHaveLength(1);
  expect(starts[0][0]).toMatchObject({
    resource,
    confirmation: `start:${resource.regionId}:${resource.resourceId}`,
  });
  await click("查询操作收据");
  expect(
    api.cloud.mock.calls.filter(([request]) => request.action === "start"),
  ).toHaveLength(1);
});

it("父组件卸载后，迟到的连接成功不触发关闭或导航", async () => {
  let resolve!: (value: unknown) => void;
  api.connection.mockResolvedValue({ connectionSaved: true });
  await render();
  api.connection.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => button("打开云窗口").click());
  act(() => root.render(null));
  await act(async () => resolve({ opened: true }));
  expect(close).not.toHaveBeenCalled();
});

it("卸载后迟到的清单响应不再查询电脑或读取连接", async () => {
  let resolve!: (value: unknown) => void;
  api.cloud.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  act(() => root.render(null));
  await act(async () => resolve({ data: { resources: [resource] } }));
  expect(api.cloud).toHaveBeenCalledExactlyOnceWith({
    action: "listResources",
  });
  expect(api.connection).not.toHaveBeenCalled();
});

it("启动已受理但实例仍为 Stopped 时继续只读观察，不重复启动", async () => {
  vi.useFakeTimers();
  let running = false;
  api.cloud.mockImplementation(async (request) => ({
    data:
      request.action === "listResources"
        ? {
            resources: [resource],
            operations: [
              {
                operationId: "original-start-operation",
                action: "start",
                outcome: running ? "lifecycleVerified" : "accepted",
                resource,
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : { status: running ? "Running" : "Stopped" },
  }));
  await render();
  expect(document.body.textContent).toContain("电脑正在启动");
  expect(
    [...document.querySelectorAll("button")].some(
      (item) => item.textContent === "启动",
    ),
  ).toBe(false);
  running = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await settle();
  expect(button("安装运行环境").disabled).toBe(false);
  expect(
    api.cloud.mock.calls.filter(
      ([request]) => request.action === "listResources",
    ),
  ).toHaveLength(2);
  expect(
    api.cloud.mock.calls.some(([request]) => request.action === "start"),
  ).toBe(false);
});

it.each(["unknown", "provisioned", "unmounted"])(
  "购买 %s 后刷新不会丢失原购买状态，只有已核验创建才返回电脑选择",
  async (scenario) => {
    const outcome = scenario === "unknown" ? "unknown" : "provisioned";
    if (outcome === "provisioned") vi.useFakeTimers();
    const profile = `lime-oauth-${"a".repeat(32)}`;
    let running = false;
    let inspectionFailed = false;
    let refreshPending = false;
    let finishRefresh!: (value: unknown) => void;
    let finishPurchase!: (value: unknown) => void;
    api.cloud.mockImplementation(async (request) => {
      if (request.action === "listResources") {
        if (refreshPending)
          return new Promise((resolve) => {
            finishRefresh = resolve;
          });
        return { data: { resources: [] } };
      }
      if (request.action === "readAlibabaConnection")
        return { data: { status: "connected", profile } };
      if (request.action === "preflightEcsPurchase")
        return purchaseNetworkProof(request);
      if (request.action === "inspect") {
        if (inspectionFailed) throw new Error("transient inspection failure");
        return {
          data: { name: "新购电脑", status: running ? "Running" : "Starting" },
        };
      }
      if (request.action === "listEcsTemplates")
        return {
          data: {
            templates: [{ id: "lt-test", name: "开发电脑", version: 1 }],
          },
        };
      if (request.action === "quoteEcsTemplate")
        return {
          data: {
            quoteId: "test-quote",
            spec: {
              ...initialEcsSpec,
              profile,
              vSwitchId: "vsw-test",
              securityGroupId: "sg-test",
              keyPairName: "",
              instanceType: "ecs.test",
              imageId: "ubuntu-test",
            },
            quote: {
              expiresAt: new Date(Date.now() + 900000).toISOString(),
              price: { hourlyPrice: 0.8, currency: "CNY" },
            },
          },
        };
      if (request.action === "purchaseEcs") {
        refreshPending = true;
        const result = {
          data: {
            outcome,
            operationId: request.operationId,
            requiresInspection: outcome === "unknown",
            instanceId: "i-purchased",
            request,
            observedAfter: {
              operationId: request.operationId,
              instanceId: "i-purchased",
              desktopName: request.desktopName,
              spec: request.spec,
              systemDiskId: "d-purchased",
              systemDiskEncrypted: true,
              chargeType: "PostPaid",
            },
          },
        };
        if (scenario === "unmounted")
          return new Promise((resolve) => {
            finishPurchase = () => resolve(result);
          });
        return result;
      }
      throw new Error(`Unexpected ${request.action}`);
    });
    await render();
    await click("添加电脑");
    const consent = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(consent).toBeTruthy();
    act(() => consent!.click());
    await settle();
    await click("确认购买");
    if (scenario === "unmounted") {
      const callsBeforeClose = api.cloud.mock.calls.length;
      act(() => root.render(null));
      await act(async () => finishPurchase(undefined));
      await settle();
      expect(api.cloud.mock.calls).toHaveLength(callsBeforeClose);
      expect(api.connection.mock.calls).toEqual([
        [
          {
            action: "prepareRuntimeRelease",
            profile,
            regionId: initialEcsSpec.regionId,
          },
        ],
      ]);
      return;
    }
    const receipts = [...document.querySelectorAll("button")].filter(
      (item) => item.textContent === "查询操作收据",
    );
    expect(receipts).toHaveLength(outcome === "unknown" ? 1 : 0);
    expect(document.body.textContent?.includes("继续设置新电脑")).toBe(
      outcome === "provisioned",
    );
    expect(
      api.cloud.mock.calls.filter(
        ([request]) => request.action === "purchaseEcs",
      ),
    ).toHaveLength(1);
    await act(async () =>
      finishRefresh({
        data: {
          resources:
            outcome === "provisioned"
              ? [
                  {
                    provider: "ecs",
                    profile: "another-account",
                    regionId: initialEcsSpec.regionId,
                    resourceId: "i-purchased",
                  },
                ]
              : [],
        },
      }),
    );
    await settle();
    if (outcome === "provisioned") {
      expect(document.activeElement?.textContent).toBe("继续设置新电脑");
      expect(document.body.textContent).toContain("新购电脑");
      expect(document.body.textContent).toContain("电脑正在启动");
      expect(
        document.querySelectorAll('[data-testid="cloud-desktop-setup"] li'),
      ).toHaveLength(1);
      expect(
        api.cloud.mock.calls
          .filter(([request]) => request.action === "inspect")
          .at(-1)?.[0].resource,
      ).toEqual({
        provider: "ecs",
        profile,
        regionId: initialEcsSpec.regionId,
        resourceId: "i-purchased",
      });
      expect(
        [...document.querySelectorAll("button")].some(
          (item) => item.textContent === "安装运行环境",
        ),
      ).toBe(false);
      refreshPending = false;
      running = true;
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      await settle();
      expect(button("安装运行环境").disabled).toBe(false);
      expect(button("任务连接").disabled).toBe(false);
      expect(
        api.connection.mock.calls.every(([request]) =>
          ["prepareRuntimeRelease", "installationStatus"].includes(
            request.action,
          ),
        ),
      ).toBe(true);
      await click("任务连接");
      expect(button("重建连接").disabled).toBe(true);
      expect(document.body.textContent).toContain("保留运行环境和文件");
      await click("关闭");
      await click("安装运行环境");
      expect(button("安装此版本 Lime").disabled).toBe(true);
      expect(
        api.connection.mock.calls.every(([request]) =>
          ["prepareRuntimeRelease", "installationStatus"].includes(
            request.action,
          ),
        ),
      ).toBe(true);
      await click("关闭");
      inspectionFailed = true;
      await click("刷新状态");
      expect(document.body.textContent).toContain("部分状态读取失败");
      expect(document.body.textContent).toContain("继续设置新电脑");
      expect(
        [...document.querySelectorAll("button")].some(
          (item) => item.textContent === "安装运行环境",
        ),
      ).toBe(false);
      inspectionFailed = false;
      await click("刷新状态");
      expect(button("安装运行环境").disabled).toBe(false);
      await click("选择其他电脑");
      expect(button("添加电脑").disabled).toBe(false);
    }
  },
);
