import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";

const api = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
import { CloudDesktopsSettings } from "./CloudDesktopsSettings";

const resource = {
  provider: "ecs" as const,
  profile: "original-profile",
  regionId: "cn-test",
  resourceId: "i-test",
};
let root: Root;
let container: HTMLDivElement;
let outcome: string;
let action: "start" | "stop";
let receiptResource = resource;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function button(label: string) {
  const element = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(element, `missing button: ${label}`).toBeTruthy();
  return element!;
}

async function click(label: string) {
  act(() => button(label).click());
  await settle();
}

async function openInstallation() {
  await click("安装运行环境");
  const consent = [...document.querySelectorAll("label")]
    .find((label) =>
      label.textContent?.includes("允许以管理员身份安装系统桌面依赖"),
    )
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(consent).toBeTruthy();
  act(() => consent!.click());
  await settle();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("electronAPI", {
    supportsCommand: () => true,
    invoke: api.invoke,
  });
  await changeLimeLocale("zh-CN");
  api.invoke.mockReset();
  api.request.mockReset();
  api.invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: true,
    busy: false,
    connectionSaved: true,
  });
  action = "stop";
  outcome = "unknown";
  receiptResource = resource;
  api.request.mockImplementation(async (params: CloudDesktopParams) => {
    if (params.action === "listResources")
      return {
        data: {
          resources: [resource],
          operations: [
            {
              action,
              outcome,
              resource: receiptResource,
              operationId: "original-operation",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      };
    if (params.action === "inspect")
      return { data: { status: "Running", instanceChargeType: "PostPaid" } };
    throw new Error(`Unexpected cloud action: ${params.action}`);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  await vi.advanceTimersByTimeAsync(0);
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ["stop", "unknown"],
  ["stop", "accepted"],
  ["start", "unknown"],
  ["start", "accepted"],
] as const)(
  "blocks installation, task connection and desktop during %s/%s",
  async (nextAction, nextOutcome) => {
    action = nextAction;
    outcome = nextOutcome;
    act(() => root.render(<CloudDesktopsSettings />));
    await settle();
    expect(button("桌面连接").disabled).toBe(true);
    await click("任务连接");
    expect(button("打开云窗口").disabled).toBe(true);
    await click("关闭");
    api.invoke.mockResolvedValue({
      kind: "installation",
      available: true,
      exists: false,
      busy: false,
    });
    await openInstallation();
    expect(button("安装此版本 Lime").disabled).toBe(true);
    await click("安装此版本 Lime");
    expect(
      api.invoke.mock.calls.every(
        ([, args]) => args.request.action === "installationStatus",
      ),
    ).toBe(true);
    expect(
      api.request.mock.calls.every(([params]) =>
        ["listResources", "inspect"].includes(params.action),
      ),
    ).toBe(true);
  },
);

it("reenables an already open installation only after the original receipt is verified", async () => {
  api.invoke.mockResolvedValue({
    kind: "installation",
    available: true,
    exists: false,
    busy: false,
  });
  act(() => root.render(<CloudDesktopsSettings />));
  await settle();
  await openInstallation();
  expect(button("安装此版本 Lime").disabled).toBe(true);
  outcome = "lifecycleVerified";
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  await settle();
  expect(button("安装此版本 Lime").disabled).toBe(false);
  await click("关闭");
  expect(button("桌面连接").disabled).toBe(false);
  expect(
    api.request.mock.calls.every(([params]) =>
      ["listResources", "inspect"].includes(params.action),
    ),
  ).toBe(true);
});

it("does not block a different account with the same instance identifier", async () => {
  receiptResource = { ...resource, profile: "other-profile" };
  act(() => root.render(<CloudDesktopsSettings />));
  await settle();
  expect(button("桌面连接").disabled).toBe(false);
  await click("任务连接");
  expect(button("打开云窗口").disabled).toBe(false);
});
