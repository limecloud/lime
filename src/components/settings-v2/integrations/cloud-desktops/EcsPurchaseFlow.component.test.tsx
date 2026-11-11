import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
import { PurchaseEcs } from "./PurchaseEcs";
import { initialEcsSpec } from "./purchaseSpecs";
import { useCloudPurchase } from "./useCloudPurchase";

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
