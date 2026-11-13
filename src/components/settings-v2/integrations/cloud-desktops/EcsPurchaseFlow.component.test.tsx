import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";

const api = vi.hoisted(() => ({ request: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: api.connection,
}));
import { PurchaseEcs } from "./PurchaseEcs";
import { initialEcsSpec } from "./purchaseSpecs";
import { useCloudPurchase } from "./useCloudPurchase";
import { purchaseNetworkProof } from "./cloudPurchase.testFixtures";

const profile = `lime-oauth-${"a".repeat(32)}`;
const otherProfile = `lime-oauth-${"b".repeat(32)}`;
const resolved = {
  ...initialEcsSpec,
  profile,
  vSwitchId: "vsw-test",
  securityGroupId: "sg-test",
  keyPairName: "key-test",
  instanceType: "ecs.test.large",
  imageId: "ubuntu-test",
};
function Harness() {
  const purchase = useCloudPurchase({
    initialSpec: initialEcsSpec,
    request: api.request,
    onPurchased: vi.fn(),
  });
  const [preparing, setPreparing] = useState(false);
  return (
    <PurchaseEcs
      purchase={purchase}
      preparing={preparing}
      onBusyChange={setPreparing}
    />
  );
}
let root: Root;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
}
function button(label: string) {
  const value = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(value, label).toBeTruthy();
  return value!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  await settle();
}
function requests(action: string) {
  return api.request.mock.calls
    .map(([value]) => value as CloudDesktopParams)
    .filter((value) => value.action === action);
}
function quote(params: CloudDesktopParams) {
  if (params.action !== "quoteEcsTemplate")
    throw new Error("Unexpected quote action");
  return {
    data: {
      quoteId: "quote-test",
      spec: { ...resolved, profile: params.profile },
      template: { id: params.launchTemplateId, version: params.version },
      quote: {
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        price: { hourlyPrice: 0.8, currency: "CNY" },
      },
    },
  };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await changeLimeLocale("zh-CN");
  api.request.mockReset();
  api.connection.mockReset().mockResolvedValue({
    kind: "guestPreparation",
    phase: "ready",
    busy: false,
    version: "test",
  });
  api.request.mockImplementation(async (params: CloudDesktopParams) => {
    if (params.action === "readAlibabaConnection")
      return { data: { status: "connected", profile } };
    if (params.action === "listEcsTemplates")
      return {
        data: {
          templates: [{ id: "lt-test", name: "Linux 桌面", version: 3 }],
        },
      };
    if (params.action === "quoteEcsTemplate") return quote(params);
    if (params.action === "preflightEcsPurchase")
      return purchaseNetworkProof(params);
    if (params.action === "purchaseEcs")
      return {
        data: { outcome: "provisioned", operationId: params.operationId },
      };
    throw new Error(`Unexpected action: ${params.action}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  await settle();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ECS 授权与模板购买", () => {
  it("无模板账号仅授权网络和确认费用即可使用推荐方案购买", async () => {
    const recommended = { ...resolved, keyPairName: "" };
    let prepared = false;
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "readAlibabaConnection")
        return { data: { status: "connected", profile } };
      if (params.action === "listEcsTemplates")
        return { data: { templates: [] } };
      if (params.action === "readEcsPurchasePreparation" && !prepared)
        return { data: { outcome: "notPrepared" } };
      if (params.action === "prepareEcsPurchase") {
        prepared = true;
        return {
          data: {
            operationId: params.operationId,
            outcome: "networkReady",
            spec: recommended,
            request: {
              action: params.action,
              regionId: params.regionId,
              profile: params.profile,
            },
          },
        };
      }
      if (params.action === "quoteEcs")
        return {
          data: {
            quoteId: "quote-test",
            quote: {
              spec: recommended,
              price: { hourlyPrice: 0.4, currency: "CNY" },
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
            },
          },
        };
      if (params.action === "preflightEcsPurchase")
        return purchaseNetworkProof(params);
      if (params.action === "purchaseEcs")
        return {
          data: { operationId: params.operationId, outcome: "accepted" },
        };
      throw new Error(`Unexpected action: ${params.action}`);
    });
    act(() => root.render(<Harness />));
    await settle();
    expect(requests("prepareEcsPurchase")).toHaveLength(0);
    expect(button("自动准备推荐方案").disabled).toBe(true);
    const networkConsent = [...container.querySelectorAll("label")]
      .find((item) => item.textContent?.includes("同意在我的账号创建专用网络"))!
      .querySelector("input")!;
    act(() => networkConsent.click());
    await settle();
    await click("自动准备推荐方案");
    expect(requests("quoteEcs")).toEqual([
      { action: "quoteEcs", spec: recommended },
    ]);
    expect(button("确认购买").disabled).toBe(true);
    const feeConsent = [...container.querySelectorAll("label")]
      .find((item) => item.textContent?.includes("确认按此规格和报价购买"))!
      .querySelector("input")!;
    act(() => feeConsent.click());
    await settle();
    await click("确认购买");
    expect(requests("purchaseEcs")).toHaveLength(1);
    expect(requests("purchaseEcs")[0]).toMatchObject({
      spec: recommended,
      desktopName: expect.stringMatching(/^Lime-/),
    });
    expect(api.connection).toHaveBeenCalledWith({
      action: "prepareRuntimeRelease",
      profile,
      regionId: "cn-hangzhou",
    });
    expect(container.querySelector("details[open]")).toBeNull();
  });
  it("连接状态读取失败不会误报权限不足，重试只读取状态", async () => {
    api.request.mockRejectedValueOnce(
      new Error("Unknown action from an older App Server"),
    );
    act(() => root.render(<Harness />));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "无法读取阿里云连接状态",
    );
    expect(container.textContent).not.toContain("CLI 应用权限");
    await click("刷新状态");
    expect(requests("connectAlibaba")).toHaveLength(0);
    expect(requests("readAlibabaConnection")).toHaveLength(2);
    expect(container.textContent).toContain("阿里云已连接");
  });
  it("复用连接并自动核价唯一模板，不输入技术参数即可确认购买", async () => {
    act(() => root.render(<Harness />));
    await settle();
    expect(requests("connectAlibaba")).toHaveLength(0);
    expect(requests("listEcsTemplates")).toEqual([
      { action: "listEcsTemplates", regionId: "cn-hangzhou", profile },
    ]);
    expect(requests("quoteEcsTemplate")).toEqual([
      {
        action: "quoteEcsTemplate",
        regionId: "cn-hangzhou",
        profile,
        launchTemplateId: "lt-test",
        version: 3,
      },
    ]);
    expect(button("确认购买").disabled).toBe(true);
    const consent = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    act(() => consent.click());
    await settle();
    await click("确认购买");
    expect(api.connection).toHaveBeenCalledExactlyOnceWith({
      action: "prepareRuntimeRelease",
      profile,
      regionId: "cn-hangzhou",
    });
    expect(requests("purchaseEcs")).toEqual([
      expect.objectContaining({
        spec: resolved,
        desktopName: expect.stringMatching(/^Lime-[a-f0-9]{8}$/),
        quoteId: "quote-test",
      }),
    ]);
    expect(
      [...container.querySelectorAll("details")].every((item) => !item.open),
    ).toBe(true);
    expect(container.querySelector('[name="AccessKey"]')).toBeNull();
  });

  it("多个模板只需选择一次，立即使用精确版本核价", async () => {
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "readAlibabaConnection")
        return { data: { status: "connected", profile } };
      if (params.action === "listEcsTemplates")
        return {
          data: {
            templates: [
              { id: "lt-first", name: "开发桌面", version: 2 },
              { id: "lt-second", name: "轻量桌面", version: 7 },
            ],
          },
        };
      return quote(params);
    });
    act(() => root.render(<Harness />));
    await settle();
    expect(requests("quoteEcsTemplate")).toHaveLength(0);
    const select = [...container.querySelectorAll("label")]
      .find((item) => item.textContent?.includes("购买模板"))!
      .querySelector("select")!;
    act(() => {
      select.value = "lt-second";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(requests("quoteEcsTemplate")).toEqual([
      expect.objectContaining({ launchTemplateId: "lt-second", version: 7 }),
    ]);
  });

  it("无 SSH 密钥对的模板可在报价过期后重新核价，重新确认再购买", async () => {
    const keyless = { ...resolved, keyPairName: "" };
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "readAlibabaConnection")
        return { data: { status: "connected", profile } };
      if (params.action === "listEcsTemplates")
        return {
          data: {
            templates: [{ id: "lt-keyless", name: "会话管理桌面", version: 1 }],
          },
        };
      if (params.action === "quoteEcsTemplate")
        return { data: { ...quote(params).data, spec: keyless } };
      if (params.action === "quoteEcs")
        return {
          data: {
            quoteId: "quote-renewed",
            quote: {
              expiresAt: new Date(Date.now() + 900000).toISOString(),
              price: { hourlyPrice: 0.8, currency: "CNY" },
            },
          },
        };
      if (params.action === "preflightEcsPurchase")
        return purchaseNetworkProof(params);
      if (params.action === "purchaseEcs")
        return {
          data: { outcome: "provisioned", operationId: params.operationId },
        };
      throw new Error(`Unexpected action: ${params.action}`);
    });
    act(() => root.render(<Harness />));
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("SSH 密钥对可留空");
    expect(button("确认购买").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(900001));
    await settle();
    expect(container.textContent).toContain("报价已失效");
    expect(button("获取实时报价").disabled).toBe(false);
    await click("获取实时报价");
    expect(requests("quoteEcs")).toEqual([
      { action: "quoteEcs", spec: keyless },
    ]);
    expect(button("确认购买").disabled).toBe(true);
    expect(requests("purchaseEcs")).toEqual([]);
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
    await click("确认购买");
    expect(requests("purchaseEcs")).toEqual([
      expect.objectContaining({ spec: keyless, quoteId: "quote-renewed" }),
    ]);
    expect(
      [...container.querySelectorAll("details")].every((item) => !item.open),
    ).toBe(true);
  });

  it.each(["vSwitchId", "securityGroupId", "imageId", "instanceType"])(
    "无 SSH 模板仍不能省略必需字段 %s",
    async (field) => {
      api.request.mockImplementation(async (params: CloudDesktopParams) => {
        if (params.action === "readAlibabaConnection")
          return { data: { status: "connected", profile } };
        if (params.action === "listEcsTemplates")
          return {
            data: {
              templates: [{ id: "lt-test", name: "不完整桌面", version: 1 }],
            },
          };
        return {
          data: {
            ...quote(params).data,
            spec: { ...resolved, keyPairName: "", [field]: "" },
          },
        };
      });
      act(() => root.render(<Harness />));
      await settle();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Invalid cloud template specification",
      );
      expect(requests("purchaseEcs")).toHaveLength(0);
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    },
  );

  it("恢复进行中的授权，不重复打开浏览器，并在完成后自动读取模板", async () => {
    let ready = false;
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "readAlibabaConnection")
        return {
          data: { status: ready ? "connected" : "authorizing", profile },
        };
      if (params.action === "listEcsTemplates")
        return { data: { templates: [] } };
      throw new Error("Unexpected request");
    });
    act(() => root.render(<Harness />));
    await settle();
    expect(container.textContent).toContain("请在浏览器完成阿里云授权");
    expect(button("连接阿里云").disabled).toBe(true);
    ready = true;
    await tick();
    expect(requests("connectAlibaba")).toHaveLength(0);
    expect(requests("listEcsTemplates")).toHaveLength(1);
    expect(container.textContent).toContain("阿里云已连接");
  });

  it("切换账号立即撤销旧报价和确认，失败时显示重试与官方帮助", async () => {
    act(() => root.render(<Harness />));
    await settle();
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
    expect(button("确认购买").disabled).toBe(false);
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "connectAlibaba")
        return { data: { status: "authorizing", profile: otherProfile } };
      if (params.action === "readAlibabaConnection")
        return {
          data: {
            status: "failed",
            profile: otherProfile,
            errorCode: "authorizationFailed",
          },
        };
      throw new Error("Unexpected request");
    });
    await click("切换阿里云账号");
    expect(button("确认购买").disabled).toBe(true);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    await tick();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "阿里云授权未完成",
    );
    expect(container.querySelector("a")?.href).toBe(
      "https://help.aliyun.com/zh/cli/oauth-credentials",
    );
    expect(requests("purchaseEcs")).toHaveLength(0);
  });
});

describe("购买前运行包检查", () => {
  async function ready() {
    act(() => root.render(<Harness />));
    await settle();
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
  }

  it("完整本机准备完成后才检查网络并购买，满字节仍在校验时保持等待", async () => {
    api.connection
      .mockResolvedValueOnce({
        kind: "guestPreparation",
        version: "test",
        phase: "downloading",
        busy: true,
        receivedBytes: 5 * 1024 ** 2,
        totalBytes: 10 * 1024 ** 2,
      })
      .mockResolvedValueOnce({
        kind: "guestPreparation",
        version: "test",
        phase: "verifying",
        busy: true,
        receivedBytes: 10 * 1024 ** 2,
        totalBytes: 10 * 1024 ** 2,
      })
      .mockResolvedValueOnce({
        kind: "guestPreparation",
        version: "test",
        phase: "ready",
        busy: false,
      });
    await ready();
    await click("确认购买");
    expect(container.textContent).toContain("此时尚未购买电脑");
    expect(container.textContent).toContain("5.0 / 10.0 MiB");
    expect(requests("preflightEcsPurchase")).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await settle();
    expect(container.textContent).toContain("10.0 / 10.0 MiB");
    expect(requests("preflightEcsPurchase")).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await settle();
    expect(api.connection.mock.calls).toEqual([
      [{ action: "prepareRuntimeRelease", profile, regionId: "cn-hangzhou" }],
      [{ action: "runtimeReleaseStatus", profile, regionId: "cn-hangzhou" }],
      [{ action: "runtimeReleaseStatus", profile, regionId: "cn-hangzhou" }],
    ]);
    expect(requests("preflightEcsPurchase")).toHaveLength(1);
    expect(requests("purchaseEcs")).toHaveLength(1);
  });

  it("缺包不会购买或创建操作；重试仍核验，只有明确选择自备环境后才可跳过", async () => {
    api.connection.mockRejectedValue(new Error("signed-url-synthetic-secret"));
    await ready();
    await click("确认购买");
    expect(requests("purchaseEcs")).toEqual([]);
    expect(container.textContent).toContain("尚未购买电脑");
    expect(container.textContent).not.toContain("synthetic-secret");
    expect(
      [...container.querySelectorAll("button")].some((item) =>
        item.textContent?.includes("查询操作收据"),
      ),
    ).toBe(false);
    await click("确认购买");
    expect(api.connection).toHaveBeenCalledTimes(2);
    expect(requests("purchaseEcs")).toEqual([]);
    const bypass = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("购买后使用已有环境"))!
      .querySelector<HTMLInputElement>("input")!;
    act(() => bypass.click());
    await settle();
    await click("确认购买");
    expect(api.connection).toHaveBeenCalledTimes(2);
    expect(requests("purchaseEcs")).toHaveLength(1);
    expect(requests("preflightEcsPurchase")).toHaveLength(1);
  });

  it("检查等待期间阻止重复购买；通过后沿原购买编号，未知结果只读原操作", async () => {
    let resolve!: (value: unknown) => void;
    api.connection.mockRejectedValueOnce(new Error("Unavailable runtime"));
    await ready();
    await click("确认购买");
    expect(container.textContent).toContain("尚未购买电脑");
    api.connection.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => {
      button("确认购买").click();
      button("确认购买").click();
    });
    await settle();
    expect(button("确认购买").disabled).toBe(true);
    expect(container.textContent).toContain("正在检查此版本");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(api.connection).toHaveBeenCalledTimes(2);
    expect(requests("purchaseEcs")).toEqual([]);
    await act(async () =>
      resolve({
        kind: "guestPreparation",
        phase: "ready",
        busy: false,
        version: "test",
      }),
    );
    await settle();
    expect(requests("purchaseEcs")).toHaveLength(1);
    expect(button("查询操作收据").disabled).toBe(false);
    api.request.mockResolvedValueOnce({ data: { outcome: "unknown" } });
    await click("查询操作收据");
    const submitted = requests("purchaseEcs")[0];
    if (submitted.action !== "purchaseEcs") throw new Error("Missing purchase");
    expect(requests("readOperation")[0]).toMatchObject({
      operationId: submitted.operationId,
    });
    expect(api.connection).toHaveBeenCalledTimes(2);
    expect(requests("purchaseEcs")).toHaveLength(1);
  });

  it("报价在检查过程中到期时不提交采购", async () => {
    let resolve!: (value: unknown) => void;
    api.connection.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await ready();
    await click("确认购买");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900001);
    });
    await act(async () =>
      resolve({
        kind: "guestPreparation",
        phase: "ready",
        busy: false,
        version: "test",
      }),
    );
    await settle();
    expect(requests("purchaseEcs")).toEqual([]);
    expect(container.textContent).toContain("报价已失效");
  });

  it("组件卸载后的检查响应不能购买", async () => {
    let resolve!: (value: unknown) => void;
    api.connection.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await ready();
    await click("确认购买");
    act(() => root.render(null));
    await act(async () =>
      resolve({
        kind: "guestPreparation",
        phase: "ready",
        busy: false,
        version: "test",
      }),
    );
    await settle();
    expect(requests("purchaseEcs")).toEqual([]);
  });
});
