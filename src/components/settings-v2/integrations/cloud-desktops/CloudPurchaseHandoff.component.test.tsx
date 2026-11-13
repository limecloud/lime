import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudDesktopsSettings } from "./CloudDesktopsSettings";
import { initialEcsSpec } from "./purchaseSpecs";
import { purchaseNetworkProof } from "./cloudPurchase.testFixtures";

const api = vi.hoisted(() => ({ request: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: api.connection,
}));

const profile = `lime-oauth-${"a".repeat(32)}`;
const resource = {
  provider: "ecs",
  profile,
  regionId: initialEcsSpec.regionId,
  resourceId: "i-purchased",
};
let root: Root;
let container: HTMLDivElement;
let outcome: "unknown" | "provisioned";
let purchase: Extract<CloudDesktopParams, { action: "purchaseEcs" }>;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
    // Radix restores focus after the closing dialog unmounts.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}
function button(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (element) =>
      element.textContent?.trim() === label &&
      !element.closest('[aria-hidden="true"]'),
  );
  expect(
    found,
    `missing button: ${label}; visible: ${[
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ]
      .map(
        (element) =>
          `${element.textContent} hidden=${!!element.closest('[aria-hidden="true"]')}`,
      )
      .join(" / ")}`,
  ).toBeTruthy();
  return found!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
function receipt() {
  return {
    outcome,
    operationId: purchase.operationId,
    requiresInspection: outcome === "unknown",
    instanceId: resource.resourceId,
    request: purchase,
    observedAfter: {
      operationId: purchase.operationId,
      instanceId: resource.resourceId,
      desktopName: purchase.desktopName,
      spec: purchase.spec,
      systemDiskId: "d-purchased",
      systemDiskEncrypted: true,
      chargeType: "PostPaid",
    },
  };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("electronAPI", {
    invoke: vi.fn(),
    supportsCommand: () => true,
    listen: () => () => undefined,
    emit: async () => undefined,
  });
  await changeLimeLocale("zh-CN");
  outcome = "provisioned";
  api.request.mockReset();
  api.connection.mockReset().mockImplementation(async (request) =>
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
  api.request.mockImplementation(async (request: CloudDesktopParams) => {
    if (request.action === "listResources")
      return { data: { resources: [], operations: [] } };
    if (request.action === "readAlibabaConnection")
      return { data: { status: "connected", profile } };
    if (request.action === "listEcsTemplates")
      return {
        data: { templates: [{ id: "lt-test", name: "开发电脑", version: 1 }] },
      };
    if (request.action === "quoteEcsTemplate")
      return {
        data: {
          quoteId: "quote-test",
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
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            price: { hourlyPrice: 0.8, currency: "CNY" },
          },
        },
      };
    if (request.action === "preflightEcsPurchase")
      return purchaseNetworkProof(request);
    if (request.action === "purchaseEcs") {
      purchase = request;
      return { data: receipt() };
    }
    if (request.action === "readOperation") return { data: receipt() };
    if (request.action === "inspect")
      return { data: { status: "Running", name: "新购电脑" } };
    throw new Error(`Unexpected action: ${request.action}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  await settle();
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["provisioned", "unknown"] as const)(
  "设置页 %s 采购沿原编号接续新机，无技术输入且保留安装授权",
  async (initialOutcome) => {
    outcome = initialOutcome;
    act(() => root.render(<CloudDesktopsSettings />));
    await settle();
    await click("添加电脑");
    expect(
      document.querySelector(
        '[role="dialog"] [role="tab"][data-state="active"]',
      )?.textContent,
    ).toBe("购买 Linux 电脑");
    expect(button("确认购买").disabled).toBe(true);
    const consent = document.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="checkbox"]',
    );
    expect(consent).toBeTruthy();
    act(() => consent!.click());
    await settle();
    await click("确认购买");
    if (initialOutcome === "unknown") {
      expect(
        document.querySelector('[data-testid="cloud-desktop-setup"]'),
      ).toBeNull();
      outcome = "provisioned";
      await click("查询操作收据");
      expect(api.request).toHaveBeenCalledWith({
        action: "readOperation",
        operationId: purchase.operationId,
      });
    }
    const setup = document.querySelector('[data-testid="cloud-desktop-setup"]');
    expect(setup?.textContent).toContain("新购电脑");
    expect(document.activeElement?.textContent).toBe("继续设置新电脑");
    expect(api.request).toHaveBeenCalledWith({ action: "inspect", resource });
    await click("安装运行环境");
    expect(button("安装此版本 Lime").disabled).toBe(true);
    expect(
      api.connection.mock.calls.every(([request]) =>
        [
          "prepareRuntimeRelease",
          "runtimeReleaseStatus",
          "installationStatus",
        ].includes(request.action),
      ),
    ).toBe(true);
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.action === "purchaseEcs",
      ),
    ).toHaveLength(1);
    await click("关闭");
    await click("关闭");
    expect(
      document.querySelector('[data-testid="cloud-desktop-setup"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(button("添加电脑"));
    await click("添加电脑");
    expect(button("确认购买").disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="cloud-desktop-setup"]'),
    ).toBeNull();
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.action === "purchaseEcs",
      ),
    ).toHaveLength(1);
  },
);
