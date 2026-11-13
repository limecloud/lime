import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudDesktopParams,
  CloudDesktopResource,
} from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudHibernation } from "./CloudHibernation";

const resource: CloudDesktopResource = {
  provider: "ecs",
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-test",
};
let root: Root;
let container: HTMLDivElement;
const request = vi.fn();
const onChanged = vi.fn();
type Props = Partial<Parameters<typeof CloudHibernation>[0]>;
const parent = (id: string, extra: Record<string, unknown> = {}) => ({
  operationId: id,
  request: { action: "hibernateEcs", resource },
  outcome: "running",
  phase: "snapshotting",
  workerActive: true,
  canResume: false,
  canCancel: true,
  ...extra,
});

async function render(props: Props = {}) {
  await act(async () =>
    root.render(
      <CloudHibernation
        resource={resource}
        status="Running"
        postPaid
        disabled={false}
        operations={[]}
        request={request}
        onChanged={onChanged}
        {...props}
      />,
    ),
  );
}
function button(text: string) {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const found = Array.from(scope.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === text,
  );
  expect(found, `missing button: ${text}`).toBeTruthy();
  return found!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function consent() {
  const checkbox = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="checkbox"]',
  );
  expect(checkbox).toBeTruthy();
  await act(async () => checkbox!.click());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  await changeLimeLocale("zh-CN");
  request.mockImplementation(async (params: CloudDesktopParams) => ({
    data: parent("operationId" in params ? params.operationId : "missing"),
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("preserve an environment with one explicit authorization", () => {
  it("requires one complete consent, shows costs and submits once without technical inputs", async () => {
    await render();
    await click("保存环境并释放");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("文件和登录信息");
    expect(dialog.textContent).toContain("仍可能收费");
    expect(dialog.querySelectorAll("input")).toHaveLength(1);
    expect(button("确认执行").disabled).toBe(true);
    await consent();
    await act(async () => {
      button("确认执行").click();
      button("确认执行").click();
    });
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "hibernateEcs",
      resource,
      operationId: expect.any(String),
      confirmation: "hibernateEcs:cn-test:i-test:private-image:discard-data",
      workSaved: true,
      includeCredentials: true,
      discardData: true,
    });
    expect(dialog.textContent).toContain("核验私有镜像");
    expect(
      dialog.querySelector('[aria-current="step"]')?.textContent,
    ).toContain("加密快照");
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("closing and reopening preserves the operation and returns focus", async () => {
    await render();
    await click("保存环境并释放");
    await consent();
    await click("确认执行");
    const id = request.mock.calls[0][0].operationId;
    await click("关闭");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("查看保存进度");
    await click("查看保存进度");
    await click("查询操作收据");
    expect(request.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({ action: "hibernateEcs", operationId: id }),
      { action: "readOperation", operationId: id },
    ]);
  });

  it("reopening after a restart reads the original receipt and only resumes on a click", async () => {
    const operations = [
      {
        action: "hibernateEcs",
        resource,
        operationId: "original",
        outcome: "running",
      },
    ];
    request.mockResolvedValue({
      data: parent("original", { workerActive: false, canResume: true }),
    });
    await render({ operations });
    await click("查看保存进度");
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "readOperation",
      operationId: "original",
    });
    expect(button("接续原操作").disabled).toBe(false);
    await click("接续原操作");
    expect(request.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        action: "hibernateEcs",
        operationId: "original",
        resource,
      }),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("a lost submit response only allows reading the same ID", async () => {
    request.mockRejectedValueOnce(new Error("response lost"));
    await render();
    await click("保存环境并释放");
    await consent();
    await click("确认执行");
    const first = request.mock.calls[0][0];
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "response lost",
    );
    expect(document.querySelector('[role="dialog"] input')).toBeNull();
    await click("查询操作收据");
    expect(request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: first.operationId,
    });
    expect(
      request.mock.calls.filter(([params]) => params.action === "hibernateEcs"),
    ).toHaveLength(1);
  });

  it("polling an active worker performs only read operations", async () => {
    vi.useFakeTimers();
    await render();
    await click("保存环境并释放");
    await consent();
    await click("确认执行");
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    const id = request.mock.calls[0][0].operationId;
    expect(request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: id,
    });
    await click("关闭");
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels future steps on the same operation and allows a fresh later authorization", async () => {
    await render();
    await click("保存环境并释放");
    await consent();
    await click("确认执行");
    const id = request.mock.calls[0][0].operationId;
    request.mockResolvedValueOnce({
      data: parent(id, {
        outcome: "cancelled",
        workerActive: false,
        canCancel: false,
      }),
    });
    await click("停止后续步骤");
    expect(request.mock.calls[1][0]).toEqual({
      action: "cancelEcsHibernation",
      operationId: id,
      confirmation: `cancelEcsHibernation:${id}`,
    });
    await click("关闭");
    await click("保存环境并释放");
    expect(button("确认执行").disabled).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(false);
  });

  it("does not offer cancellation after release starts", async () => {
    request.mockImplementation(async (params: { operationId: string }) => ({
      data: parent(params.operationId, {
        phase: "releasing",
        canCancel: false,
      }),
    }));
    await render();
    await click("保存环境并释放");
    await consent();
    await click("确认执行");
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("停止后续步骤");
  });

  it.each(["profile", "resourceId"] as const)(
    "discards pending consent when %s changes",
    async (key) => {
      await render();
      await click("保存环境并释放");
      await consent();
      await render({
        resource: {
          ...resource,
          [key]: key === "profile" ? "other" : "i-other",
        },
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await click("保存环境并释放");
      expect(button("确认执行").disabled).toBe(true);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("invalidates consent when the computer becomes unavailable", async () => {
    await render();
    await click("保存环境并释放");
    await consent();
    await render({ disabled: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render();
    await click("保存环境并释放");
    expect(button("确认执行").disabled).toBe(true);
  });

  it("rejects a response for another target without exposing resume or cancellation", async () => {
    request.mockImplementation(async (params: { operationId: string }) => ({
      data: parent(params.operationId, {
        request: {
          action: "hibernateEcs",
          resource: { ...resource, profile: "other" },
        },
        canResume: true,
      }),
    }));
    await render();
    await click("保存环境并释放");
    await consent();
    await click("确认执行");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("接续原操作");
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("停止后续步骤");
  });
});
