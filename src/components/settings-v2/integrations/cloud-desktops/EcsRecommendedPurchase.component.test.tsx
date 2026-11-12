import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type {
  CloudDesktopParams,
  EcsDesktopSpec,
} from "@limecloud/app-server-client";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
import { EcsRecommendedPurchase } from "./EcsRecommendedPurchase";
import { useCloudPurchase } from "./useCloudPurchase";
import { initialEcsSpec } from "./purchaseSpecs";
import { PurchaseActions } from "./PurchaseActions";

const recommended: EcsDesktopSpec = {
  ...initialEcsSpec,
  profile: "test",
  regionId: "cn-test",
  instanceType: "ecs.test.large",
  imageId: "ubuntu-test",
  vSwitchId: "vsw-test",
  securityGroupId: "sg-test",
};
const receipt = (outcome: string, profile = "test") => ({
  operationId: "original-network",
  outcome,
  createdAt: new Date().toISOString(),
  spec: { ...recommended, profile },
  request: { action: "prepareEcsPurchase", regionId: "cn-test", profile },
});
const onBusyChange = vi.fn();
function Harness({ profile = "test" }: { profile?: string }) {
  const purchase = useCloudPurchase({
    initialSpec: { ...initialEcsSpec, profile, regionId: "cn-test" },
    request: api.request,
    onPurchased: vi.fn(),
  });
  return (
    <>
      <EcsRecommendedPurchase purchase={purchase} onBusyChange={onBusyChange} />
      <PurchaseActions purchase={purchase} />
    </>
  );
}
let root: Root;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function button(text: string) {
  const result = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(result, text).toBeTruthy();
  return result!;
}
async function click(text: string) {
  act(() => button(text).click());
  await settle();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.request.mockReset();
  onBusyChange.mockReset();
  api.request.mockImplementation(async (params: CloudDesktopParams) => ({
    data:
      params.action === "readEcsPurchasePreparation"
        ? { outcome: "notPrepared" }
        : receipt("networkPreparing"),
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("无模板账号推荐购买", () => {
  it("首次仅只读查询，同意网络授权后才准备，重复点击不会提交第二次", async () => {
    act(() => root.render(<Harness />));
    await settle();
    expect(api.request.mock.calls.map(([params]) => params.action)).toEqual([
      "readEcsPurchasePreparation",
    ]);
    expect(button("自动准备推荐方案").disabled).toBe(true);
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
    let finish!: (value: unknown) => void;
    api.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => {
      button("自动准备推荐方案").click();
      button("自动准备推荐方案").click();
    });
    await settle();
    const request = api.request.mock.calls[1][0];
    expect(request).toMatchObject({
      action: "prepareEcsPurchase",
      regionId: "cn-test",
      profile: "test",
      confirmation: `prepareEcsPurchase:cn-test:test:${request.operationId}`,
    });
    expect(api.request).toHaveBeenCalledTimes(2);
    await act(async () => finish({ data: receipt("networkPreparing") }));
    await settle();
    expect(container.textContent).toContain("不会重复创建");
  });

  it("已核验网络自动填写并核价，仍须单独确认费用才可购买", async () => {
    api.request.mockImplementation(async (params: CloudDesktopParams) => ({
      data:
        params.action === "readEcsPurchasePreparation"
          ? receipt("networkReady")
          : {
              quoteId: "quote-test",
              quote: {
                spec: recommended,
                price: { hourlyPrice: 0.4, currency: "CNY" },
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
              },
            },
    }));
    act(() => root.render(<Harness />));
    await settle();
    expect(api.request.mock.calls[1][0]).toEqual({
      action: "quoteEcs",
      spec: recommended,
    });
    expect(container.textContent).toContain("网络已核验");
    expect(button("确认购买").disabled).toBe(true);
    expect(
      api.request.mock.calls.some(
        ([params]) => params.action === "purchaseEcs",
      ),
    ).toBe(false);
  });

  it("关闭后重开只观察原未知操作，不提交网络或采购", async () => {
    api.request.mockResolvedValue({ data: receipt("unknown") });
    act(() => root.render(<Harness key="one" />));
    await settle();
    act(() => root.render(<Harness key="two" />));
    await settle();
    await click("查看准备进度");
    expect(
      api.request.mock.calls.every(
        ([params]) => params.action === "readEcsPurchasePreparation",
      ),
    ).toBe(true);
    expect(
      container.querySelector('input[type="checkbox"]')?.closest("label")
        ?.textContent ?? "",
    ).not.toContain("同意在我的账号");
  });

  it("报价失败保留原网络，显式查询后可以重新核价", async () => {
    let failed = true;
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "readEcsPurchasePreparation")
        return { data: receipt("networkReady") };
      if (failed) throw new Error("fixture failure");
      return {
        data: {
          quoteId: "quote-test",
          quote: {
            spec: recommended,
            price: { hourlyPrice: 0.4, currency: "CNY" },
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        },
      };
    });
    act(() => root.render(<Harness />));
    await settle();
    expect(container.textContent).toContain("暂时无法读取推荐方案");
    failed = false;
    await click("查看准备进度");
    expect(container.textContent).not.toContain("暂时无法读取推荐方案");
    expect(
      api.request.mock.calls.filter(([params]) => params.action === "quoteEcs"),
    ).toHaveLength(2);
    expect(
      api.request.mock.calls.some(
        ([params]) => params.action === "prepareEcsPurchase",
      ),
    ).toBe(false);
  });

  it("丢弃离页后的迟到推荐，不为新账号核价", async () => {
    let finish!: (value: unknown) => void;
    api.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => root.render(<Harness key="old" />));
    await settle();
    act(() => root.render(<Harness key="new" profile="another" />));
    await settle();
    await act(async () => finish({ data: receipt("networkReady") }));
    await settle();
    expect(api.request.mock.calls.map(([params]) => params.action)).toEqual([
      "readEcsPurchasePreparation",
      "readEcsPurchasePreparation",
    ]);
  });

  it("五语言均提供准备说明、授权及恢复文案", async () => {
    for (const locale of [
      "zh-CN",
      "zh-TW",
      "en-US",
      "ja-JP",
      "ko-KR",
    ] as const) {
      await act(async () => changeLimeLocale(locale));
      act(() => root.render(<Harness key={locale} />));
      await settle();
      expect(container.textContent).not.toContain(
        "settings.cloudDesktop.recommended",
      );
      expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
    }
  });
});
