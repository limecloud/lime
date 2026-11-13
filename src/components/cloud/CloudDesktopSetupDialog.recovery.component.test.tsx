import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import CloudDesktopSetupDialog from "./CloudDesktopSetupDialog";

const api = vi.hoisted(() => ({ cloud: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.cloud }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: api.connection,
}));

const resource = {
  provider: "ecs" as const,
  profile: "lime-oauth-test",
  regionId: "cn-test",
  resourceId: "i-test",
};
let root: Root;
let container: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
}

function buttons() {
  return Array.from(document.querySelectorAll("button"));
}

async function click(text: string) {
  const scope = Array.from(document.querySelectorAll('[role="dialog"]')).at(-1);
  const button = Array.from(
    (scope ?? document).querySelectorAll("button"),
  ).find((entry) => entry.textContent === text);
  expect(button, `missing button: ${text}`).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  api.cloud.mockReset();
  api.connection.mockReset();
  api.connection.mockResolvedValue({ connectionSaved: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ["start", "unknown", "Stopped"],
  ["start", "accepted", "Stopped"],
  ["stop", "unknown", "Running"],
  ["stop", "accepted", "Running"],
])(
  "重开引导恢复过期的 %s / %s 原编号，不新建变更",
  async (action, outcome, status) => {
    vi.useFakeTimers();
    const operationId = "original-lifecycle-operation";
    let verified = false;
    let observedStatus = status;
    api.cloud.mockImplementation(async (request) => {
      if (request.action === "listResources")
        return {
          data: {
            resources: [resource],
            operations: [
              {
                operationId,
                action,
                outcome: verified ? "lifecycleVerified" : outcome,
                resource,
                createdAt: "2025-01-01T00:00:00Z",
              },
            ],
          },
        };
      if (request.action === "inspect")
        return {
          data: {
            name: "开发电脑",
            status: verified
              ? action === "start"
                ? "Running"
                : "Stopped"
              : observedStatus,
          },
        };
      if (request.action === "readOperation") {
        expect(request.operationId).toBe(operationId);
        verified = true;
        return {
          data: {
            operationId,
            outcome: "lifecycleVerified",
            requiresInspection: false,
          },
        };
      }
      throw new Error(`unexpected mutation: ${request.action}`);
    });
    act(() => root.render(<CloudDesktopSetupDialog onClose={() => {}} />));
    await settle();
    expect(buttons().some((button) => button.textContent === "启动")).toBe(
      false,
    );
    expect(
      buttons().some((button) => button.textContent === "打开云窗口"),
    ).toBe(false);
    expect(
      buttons().some((button) => button.textContent === "安装运行环境"),
    ).toBe(false);
    observedStatus = action === "start" ? "Running" : "Stopped";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(
      buttons().some((button) => button.textContent === "打开云窗口"),
    ).toBe(false);
    expect(buttons().some((button) => button.textContent === "启动")).toBe(
      false,
    );
    await click("查询操作收据");
    expect(
      Array.from(document.querySelectorAll('[role="dialog"]')).at(-1)
        ?.textContent,
    ).toContain(operationId);
    expect(buttons().some((button) => button.textContent === "确认执行")).toBe(
      false,
    );
    await click("查询操作收据");
    expect(
      api.cloud.mock.calls
        .filter(([request]) => request.action === "readOperation")
        .map(([request]) => request),
    ).toEqual([{ action: "readOperation", operationId }]);
    await click("关闭");
    expect(
      buttons().some(
        (button) =>
          button.textContent === (action === "start" ? "打开云窗口" : "启动"),
      ),
    ).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(
      api.cloud.mock.calls.every(([request]) =>
        ["listResources", "inspect", "readOperation"].includes(request.action),
      ),
    ).toBe(true);
    expect(
      api.connection.mock.calls.every(
        ([request]) => request.action === "installationStatus",
      ),
    ).toBe(true);
  },
);

it.each(["profile", "regionId", "resourceId", "provider"])(
  "不会恢复另一个 %s 的操作或让它阻塞当前账号电脑",
  async (field) => {
    api.cloud.mockImplementation(async ({ action }) => ({
      data:
        action === "listResources"
          ? {
              resources: [resource],
              operations: [
                {
                  operationId: "other-account-operation",
                  action: "stop",
                  outcome: "unknown",
                  resource: {
                    ...resource,
                    [field]: field === "provider" ? "wuying" : "other",
                  },
                  createdAt: "2025-01-01T00:00:00Z",
                },
              ],
            }
          : { name: "当前账号电脑", status: "Running" },
    }));
    act(() => root.render(<CloudDesktopSetupDialog onClose={() => {}} />));
    await settle();
    expect(
      buttons().some((button) => button.textContent === "查询操作收据"),
    ).toBe(false);
    expect(
      buttons().some((button) => button.textContent === "打开云窗口"),
    ).toBe(true);
    expect(
      api.cloud.mock.calls.every(([request]) =>
        ["listResources", "inspect"].includes(request.action),
      ),
    ).toBe(true);
  },
);
