import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
import { CloudDesktopsSettings } from "./CloudDesktopsSettings";

const resource = {
  provider: "ecs",
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-test",
};
let root: Root;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
async function click(name: string) {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const button = Array.from(scope.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  );
  expect(button, name).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps the final dialog mounted after release removes the computer from the list", async () => {
  let released = false;
  api.request.mockImplementation(async (params: CloudDesktopParams) => {
    if (params.action === "listResources")
      return {
        data: { resources: released ? [] : [resource], operations: [] },
      };
    if (params.action === "inspect")
      return {
        data: {
          status: "Running",
          name: "Test computer",
          instanceChargeType: "PostPaid",
        },
      };
    if (params.action === "hibernateEcs") {
      released = true;
      return {
        data: {
          operationId: params.operationId,
          request: { action: "hibernateEcs", resource },
          outcome: "hibernated",
          phase: "releasing",
          workerActive: false,
          canResume: false,
          canCancel: false,
        },
      };
    }
    throw Error(`Unexpected action: ${params.action}`);
  });
  await act(async () => root.render(<CloudDesktopsSettings />));
  await settle();
  await click("保存环境并释放");
  const checkbox = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="checkbox"]',
  )!;
  await act(async () => checkbox.click());
  await click("确认执行");
  expect(released).toBe(true);
  expect(container.textContent).not.toContain("Test computer");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "原机已确认释放",
  );
  await click("关闭");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(
    api.request.mock.calls.filter(
      ([params]) => params.action === "hibernateEcs",
    ),
  ).toHaveLength(1);
});

it("resumes from history when the computer is gone and preserves completion after history refresh", async () => {
  let complete = false;
  const entry = {
    action: "hibernateEcs",
    operationId: "original",
    resource,
    outcome: "paused",
    createdAt: new Date().toISOString(),
  };
  api.request.mockImplementation(async (params: CloudDesktopParams) => {
    if (params.action === "listResources")
      return { data: { resources: [], operations: complete ? [] : [entry] } };
    if (params.action === "hibernateEcs") complete = true;
    if (params.action === "readOperation" || params.action === "hibernateEcs")
      return {
        data: {
          operationId: "original",
          request: { action: "hibernateEcs", resource },
          phase: "releasing",
          outcome: complete ? "hibernated" : "paused",
          workerActive: false,
          canResume: !complete,
          canCancel: false,
        },
      };
    throw Error(`Unexpected action: ${params.action}`);
  });
  await act(async () => root.render(<CloudDesktopsSettings />));
  await settle();
  await click("查看保存进度");
  expect(
    api.request.mock.calls.filter(
      ([params]) => params.action === "hibernateEcs",
    ),
  ).toHaveLength(0);
  await click("接续原操作");
  expect(
    api.request.mock.calls.find(
      ([params]) => params.action === "hibernateEcs",
    )?.[0],
  ).toEqual(expect.objectContaining({ operationId: "original", resource }));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "原机已确认释放",
  );
  await click("关闭");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
