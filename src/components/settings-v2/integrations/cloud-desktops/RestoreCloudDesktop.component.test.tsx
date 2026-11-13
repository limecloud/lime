import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";
import { RestoreCloudDesktop } from "./RestoreCloudDesktop";
import { initialEcsSpec } from "./purchaseSpecs";
import { useCloudPurchase } from "./useCloudPurchase";
import { purchaseNetworkProof } from "./cloudPurchase.testFixtures";

const api = vi.hoisted(() => ({ request: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: api.connection,
}));

const profile = `lime-oauth-${"a".repeat(32)}`;
const base = {
  ...initialEcsSpec,
  profile,
  vSwitchId: "vsw-test",
  securityGroupId: "sg-test",
  instanceType: "ecs.test.large",
  imageId: "ubuntu-test",
};
const images = [
  {
    imageId: "m-saved",
    name: "Saved environment",
    systemDiskGiB: 100,
    ready: true,
    encrypted: true,
    private: true,
  },
  {
    imageId: "m-other",
    name: "Other environment",
    systemDiskGiB: 120,
    ready: true,
    encrypted: true,
    private: true,
  },
];
let root: Root;
let container: HTMLDivElement;
let ready = false;
let onChanged: ReturnType<typeof vi.fn>;
let template = true;
let prepared = false;
let quoteSpecMismatch = false;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}
function buttons() {
  return [...document.querySelectorAll<HTMLButtonElement>("button")];
}
function button(label: string) {
  const found = buttons().find((item) => item.textContent?.trim() === label);
  expect(found, label).toBeTruthy();
  return found!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
function calls(action: string) {
  return api.request.mock.calls
    .map(([p]) => p as CloudDesktopParams)
    .filter((p) => p.action === action);
}
function render() {
  act(() =>
    root.render(
      <RestoreCloudDesktop onChanged={onChanged} isRunning={() => ready} />,
    ),
  );
}
async function selectImage(id: string) {
  const select = [
    ...document.querySelectorAll<HTMLSelectElement>("select"),
  ].find((el) => [...el.options].some((o) => o.value === id))!;
  expect(select).toBeTruthy();
  expect(select.disabled).toBe(false);
  act(() => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
async function approve() {
  const label = [...document.querySelectorAll("label")].find((el) =>
    el.textContent?.includes("确认按此规格和报价购买"),
  )!;
  const input = label.querySelector<HTMLInputElement>("input")!;
  act(() => input.click());
  await settle();
}
async function open() {
  render();
  await click("从已保存环境恢复");
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await changeLimeLocale("zh-CN");
  ready = false;
  template = true;
  prepared = false;
  quoteSpecMismatch = false;
  onChanged = vi.fn();
  api.connection.mockReset().mockResolvedValue({
    kind: "guestRelease",
    available: true,
    version: "test",
  });
  api.request.mockReset().mockImplementation(async (p: CloudDesktopParams) => {
    if (p.action === "readAlibabaConnection")
      return { data: { status: "connected", profile } };
    if (p.action === "listEcsImages")
      return { data: { profile: p.profile, regionId: p.regionId, images } };
    if (p.action === "listEcsTemplates")
      return {
        data: {
          templates: template
            ? [{ id: "lt-test", name: "Linux desktop", version: 1 }]
            : [],
        },
      };
    if (p.action === "quoteEcsTemplate")
      return {
        data: {
          quoteId: "base-quote",
          spec: base,
          quote: {
            spec: base,
            expiresAt: new Date(Date.now() + 900000).toISOString(),
            price: { hourlyPrice: 0.4, currency: "CNY" },
          },
        },
      };
    if (p.action === "readEcsPurchasePreparation" && !prepared)
      return { data: { outcome: "notPrepared" } };
    if (p.action === "prepareEcsPurchase") {
      prepared = true;
      return {
        data: {
          operationId: p.operationId,
          request: {
            action: p.action,
            profile: p.profile,
            regionId: p.regionId,
          },
          outcome: "networkReady",
          spec: base,
        },
      };
    }
    if (p.action === "quoteEcs")
      return {
        data: {
          quoteId: "image-quote",
          quote: {
            spec: quoteSpecMismatch ? base : p.spec,
            expiresAt: new Date(Date.now() + 900000).toISOString(),
            price: { hourlyPrice: 0.5, currency: "CNY" },
          },
        },
      };
    if (p.action === "preflightEcsPurchase") return purchaseNetworkProof(p);
    if (p.action === "purchaseEcs")
      return {
        data: {
          operationId: p.operationId,
          request: { ...p },
          outcome: "unknown",
          requiresInspection: true,
        },
      };
    if (p.action === "readOperation")
      return { data: { operationId: p.operationId, outcome: "unknown" } };
    throw new Error(`Unexpected request ${p.action}`);
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

it("loads private images after authorization and reprices the chosen image after resolving a template", async () => {
  await open();
  expect(calls("listEcsImages")).toEqual([
    { action: "listEcsImages", profile, regionId: "cn-hangzhou" },
  ]);
  expect(calls("listEcsTemplates")).toHaveLength(0);
  expect(button("确认购买").disabled).toBe(true);
  await selectImage("m-saved");
  expect(calls("quoteEcsTemplate")).toHaveLength(1);
  expect(calls("quoteEcs")).toEqual([
    {
      action: "quoteEcs",
      spec: { ...base, imageId: "m-saved", systemDiskGib: 100 },
    },
  ]);
  expect(button("确认购买").disabled).toBe(true);
  expect(calls("purchaseEcs")).toHaveLength(0);
  await approve();
  await click("确认购买");
  expect(calls("purchaseEcs")).toEqual([
    expect.objectContaining({
      spec: { ...base, imageId: "m-saved", systemDiskGib: 100 },
      quoteId: "image-quote",
    }),
  ]);
  expect(api.connection).not.toHaveBeenCalled();
});

it("reuses network preparation and quotes a saved image instead of the recommended base OS", async () => {
  template = false;
  await open();
  await selectImage("m-saved");
  expect(calls("prepareEcsPurchase")).toHaveLength(0);
  expect(button("自动准备推荐方案").disabled).toBe(true);
  const input = [...document.querySelectorAll("label")]
    .find((el) => el.textContent?.includes("同意在我的账号创建专用网络"))!
    .querySelector<HTMLInputElement>("input")!;
  act(() => input.click());
  await settle();
  await click("自动准备推荐方案");
  expect(calls("prepareEcsPurchase")).toHaveLength(1);
  expect(calls("quoteEcs")).toEqual([
    {
      action: "quoteEcs",
      spec: { ...base, imageId: "m-saved", systemDiskGib: 100 },
    },
  ]);
  expect(calls("purchaseEcs")).toHaveLength(0);
});

it("changing the saved environment invalidates consent and immediately obtains the new image price", async () => {
  await open();
  await selectImage("m-saved");
  await approve();
  expect(button("确认购买").disabled).toBe(false);
  await selectImage("m-other");
  expect(calls("quoteEcs")).toHaveLength(2);
  expect(calls("quoteEcs")[1]).toMatchObject({
    spec: { imageId: "m-other", systemDiskGib: 120 },
  });
  expect(button("确认购买").disabled).toBe(true);
  expect(calls("purchaseEcs")).toHaveLength(0);
});

it("rejects a quote that silently prices the base OS rather than the selected image", async () => {
  quoteSpecMismatch = true;
  await open();
  await selectImage("m-saved");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "does not match",
  );
  expect(button("确认购买").disabled).toBe(true);
  expect(calls("purchaseEcs")).toHaveLength(0);
});

it("renews an expired price for the same private image and requires fresh fee consent", async () => {
  await open();
  await selectImage("m-saved");
  await approve();
  await act(async () => vi.advanceTimersByTimeAsync(900001));
  await settle();
  expect(button("确认购买").disabled).toBe(true);
  await click("获取实时报价");
  expect(calls("quoteEcs")).toHaveLength(2);
  expect(calls("quoteEcs")[1]).toMatchObject({
    spec: { imageId: "m-saved", systemDiskGib: 100 },
  });
  expect(button("确认购买").disabled).toBe(true);
});

it("keeps an unknown purchase on the same operation across close and reopen", async () => {
  await open();
  await selectImage("m-saved");
  await approve();
  await click("确认购买");
  const submitted = calls("purchaseEcs")[0];
  if (submitted.action !== "purchaseEcs") throw Error("missing purchase");
  await click("关闭");
  await click("从已保存环境恢复");
  await click("查询操作收据");
  expect(calls("readOperation")).toEqual([
    { action: "readOperation", operationId: submitted.operationId },
  ]);
  expect(calls("purchaseEcs")).toHaveLength(1);
});

it("offers reconnection only after the exact verified purchase and actual Running projection", async () => {
  const implementation = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (p: CloudDesktopParams) =>
    p.action === "purchaseEcs"
      ? {
          data: {
            operationId: p.operationId,
            outcome: "provisioned",
            requiresInspection: false,
            instanceId: "i-restored",
            request: p,
            observedAfter: {
              operationId: p.operationId,
              desktopName: p.desktopName,
              instanceId: "i-restored",
              systemDiskId: "d-restored",
              systemDiskEncrypted: true,
              spec: p.spec,
              chargeType: "PostPaid",
            },
          },
        }
      : implementation(p),
  );
  await open();
  await selectImage("m-saved");
  await approve();
  await click("确认购买");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "新电脑已按所选镜像创建",
  );
  expect(buttons().some((el) => el.textContent?.trim() === "任务连接")).toBe(
    false,
  );
  ready = true;
  render();
  await settle();
  expect(button("任务连接")).toBeTruthy();
  expect(api.connection).not.toHaveBeenCalled();
});

it.each(["context-change", "unmount"])(
  "discards a late template response after %s without pricing or purchasing",
  async (change) => {
    let resolve!: (value: unknown) => void;
    api.request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    function Harness() {
      const [image, setImage] = useState("m-saved");
      const resolveSpec = useCallback(
        (spec: typeof base) => ({ ...spec, imageId: image }),
        [image],
      );
      const purchase = useCloudPurchase({
        initialSpec: base,
        request: api.request,
        onPurchased: vi.fn(),
        resolveSpec,
      });
      return (
        <>
          <button
            onClick={() =>
              void purchase.run("quote", { id: "lt-test", version: 1 })
            }
          >
            quote
          </button>
          <button onClick={() => setImage("m-other")}>change</button>
          <output>
            {JSON.stringify({ quote: purchase.quote, error: purchase.error })}
          </output>
        </>
      );
    }
    act(() => root.render(<Harness />));
    await click("quote");
    if (change === "unmount") act(() => root.render(null));
    else await click("change");
    await act(async () =>
      resolve({
        data: { quoteId: "base-quote", spec: base, quote: { spec: base } },
      }),
    );
    await settle();
    expect(calls("quoteEcs")).toHaveLength(0);
    expect(calls("purchaseEcs")).toHaveLength(0);
    if (change !== "unmount")
      expect(
        JSON.parse(container.querySelector("output")!.textContent!),
      ).toEqual({ error: "" });
  },
);
