import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudScheduledRelease } from "./CloudScheduledRelease";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const resource = {
  provider: "ecs" as const,
  regionId: "cn-test",
  resourceId: "i-test",
  profile: "owned",
};
const image = {
  operationId: "image-1",
  action: "createEcsImage",
  outcome: "imageReady",
  resource,
};
let root: Root;
let container: HTMLDivElement;
const request = vi.fn();
const changed = vi.fn();
function render(
  props: Partial<Parameters<typeof CloudScheduledRelease>[0]> = {},
) {
  act(() =>
    root.render(
      <CloudScheduledRelease
        resource={resource}
        status="Stopped"
        postPaid
        operations={[image]}
        disabled={false}
        request={request}
        onChanged={changed}
        {...props}
      />,
    ),
  );
}
function button(text: string) {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((element) => element.textContent?.trim() === text);
  expect(result, text).toBeTruthy();
  return result!;
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
async function click(text: string) {
  act(() => button(text).click());
  await settle();
}
function approve() {
  act(() => approval().click());
}
function approval() {
  return document.querySelector<HTMLInputElement>(
    "[role=dialog] input[type=checkbox]",
  )!;
}
function selectImage() {
  const select = document.querySelector<HTMLSelectElement>(
    "[role=dialog] select",
  )!;
  act(() => {
    select.value = "image-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  request.mockReset();
  changed.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("provider scheduled release", () => {
  it.each(["2099-01-01T01:00:00Z", undefined])(
    "invalidates cancellation consent when the observed deadline changes to %s",
    async (nextDeadline) => {
      const releaseAt = "2099-01-01T00:00:00Z";
      render({ autoReleaseTime: releaseAt });
      await click("撤销定时释放");
      approve();
      expect(button("确认执行").disabled).toBe(false);

      render({ autoReleaseTime: nextDeadline });
      expect(approval().checked).toBe(false);
      expect(button("确认执行").disabled).toBe(true);
      await click("确认执行");
      expect(request).not.toHaveBeenCalled();
      expect(document.querySelector("[role=dialog]")?.textContent).toContain(
        new Date(releaseAt).toLocaleString(),
      );

      await click("关闭");
      render({ autoReleaseTime: nextDeadline });
      await click(nextDeadline ? "撤销定时释放" : "定时释放");
      if (!nextDeadline) selectImage();
      approve();
      request.mockResolvedValue({ data: { outcome: "unknown" } });
      await click("确认执行");
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][0].action).toBe(
        nextDeadline ? "cancelEcsRelease" : "scheduleEcsRelease",
      );
      if (nextDeadline)
        expect(request.mock.calls[0][0].releaseAt).toBe(nextDeadline);
    },
  );

  it("does not transfer approval to another desktop identity", async () => {
    const releaseAt = "2099-01-01T00:00:00Z";
    render({ autoReleaseTime: releaseAt });
    await click("撤销定时释放");
    approve();
    render({
      autoReleaseTime: releaseAt,
      resource: { ...resource, profile: "other-account" },
    });
    expect(approval().checked).toBe(false);
    expect(button("确认执行").disabled).toBe(true);
    await click("确认执行");
    expect(request).not.toHaveBeenCalled();
    render({ autoReleaseTime: releaseAt });
    expect(approval().checked).toBe(false);
  });

  it("invalidates consent when the selected image disappears and does not revive it when the image returns", async () => {
    render();
    await click("定时释放");
    selectImage();
    approve();
    render({ operations: [] });
    expect(approval().checked).toBe(false);
    expect(button("确认执行").disabled).toBe(true);
    await click("确认执行");
    expect(request).not.toHaveBeenCalled();
    render();
    expect(approval().checked).toBe(false);
    approve();
    request.mockResolvedValue({ data: { outcome: "unknown" } });
    await click("确认执行");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("honors parent availability after opening and requires fresh consent when availability returns", async () => {
    render();
    await click("定时释放");
    selectImage();
    approve();
    render({ disabled: true });
    expect(approval().checked).toBe(false);
    expect(button("确认执行").disabled).toBe(true);
    await click("确认执行");
    expect(request).not.toHaveBeenCalled();
    render();
    expect(approval().checked).toBe(false);
  });

  it.each([{ status: "Running" }, { postPaid: false }])(
    "does not revive consent after the instance becomes unavailable: %o",
    async (unavailable) => {
      render();
      await click("定时释放");
      selectImage();
      approve();
      render(unavailable);
      expect(document.querySelector("[role=dialog]")).toBeNull();
      render();
      expect(approval().checked).toBe(false);
      expect(button("确认执行").disabled).toBe(true);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("requires an exact completed image and explicit deadline consent, submits once, then reads the original operation", async () => {
    let resolve!: (value: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render();
    await click("定时释放");
    expect(document.body.textContent).toContain("释放保护也不会阻止");
    expect(button("确认执行").disabled).toBe(true);
    selectImage();
    expect(button("确认执行").disabled).toBe(true);
    approve();
    act(() => {
      button("确认执行").click();
      button("确认执行").click();
    });
    expect(request).toHaveBeenCalledTimes(1);
    const submitted = request.mock.calls[0][0];
    expect(submitted).toMatchObject({
      action: "scheduleEcsRelease",
      resource,
      imageOperationId: "image-1",
      discardData: true,
      workSaved: true,
    });
    expect(submitted.confirmation).toBe(
      `scheduleEcsRelease:cn-test:i-test:${submitted.releaseAt}:discard-data:image:image-1`,
    );
    expect(Date.parse(submitted.releaseAt) - Date.now()).toBeGreaterThan(
      30 * 60000,
    );
    expect(new Date(submitted.releaseAt).getUTCSeconds()).toBe(0);
    resolve({
      data: {
        outcome: "unknown",
        operationId: submitted.operationId,
        request: submitted,
      },
    });
    await settle();
    render({ autoReleaseTime: submitted.releaseAt });
    expect(document.querySelector("[role=dialog] h2")?.textContent).toBe(
      "定时释放",
    );
    request.mockResolvedValue({ data: { outcome: "scheduled" } });
    await click("查询操作收据");
    expect(request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: submitted.operationId,
    });
    expect(
      request.mock.calls.filter(
        ([params]) => params.action === "scheduleEcsRelease",
      ),
    ).toHaveLength(1);
    expect(
      document.querySelector("[role=dialog] input[type=checkbox]"),
    ).toBeNull();
  });

  it("recovers an unresolved operation after remount without offering a new submission", async () => {
    request.mockResolvedValue({ data: { outcome: "unknown" } });
    render({
      operations: [
        {
          action: "scheduleEcsRelease",
          resource,
          operationId: "original",
          outcome: "unknown",
          releaseAt: "2099-01-01T00:00:00Z",
        },
      ],
    });
    await click("检查回收计划");
    expect(
      document.querySelector("[role=dialog] input[type=checkbox]"),
    ).toBeNull();
    await click("查询操作收据");
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "readOperation",
      operationId: "original",
    });
  });

  it("binds cancellation to the observed deadline and waits for provider verification", async () => {
    const releaseAt = "2099-01-01T00:00:00Z";
    request
      .mockResolvedValueOnce({ data: { outcome: "accepted" } })
      .mockResolvedValueOnce({
        data: {
          outcome: "releaseCancelled",
          diagnostic: "Old submission failed; inspect before retrying",
        },
      });
    render({ status: "Running", autoReleaseTime: releaseAt });
    await click("撤销定时释放");
    expect(button("确认执行").disabled).toBe(true);
    approve();
    await click("确认执行");
    expect(request.mock.calls[0][0]).toMatchObject({
      action: "cancelEcsRelease",
      resource,
      releaseAt,
      confirmation: `cancelEcsRelease:cn-test:i-test:${releaseAt}`,
    });
    expect(document.body.textContent).not.toContain(
      "已确认撤销，实例和磁盘继续保留。",
    );
    render();
    expect(document.querySelector("[role=dialog] h2")?.textContent).toBe(
      "撤销定时释放",
    );
    await click("查询操作收据");
    expect(document.body.textContent).toContain(
      "已确认撤销，实例和磁盘继续保留。",
    );
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.textContent).not.toContain("Old submission failed");
    expect(dialog.textContent).not.toContain("到期将释放");
    expect(dialog.querySelectorAll("button")).toHaveLength(1);
    expect(dialog.querySelector("button")?.textContent).toBe("关闭");
  });

  it("does not accept another desktop’s image or expose scheduling on a running instance", async () => {
    render({ status: "Running" });
    expect(container.textContent).toBe("");
    render({
      operations: [
        { ...image, resource: { ...resource, resourceId: "i-other" } },
      ],
    });
    await click("定时释放");
    expect(document.querySelectorAll("[role=dialog] option")).toHaveLength(1);
    approve();
    expect(button("确认执行").disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("allows a fresh confirmation only after an explicit no-submission result", async () => {
    request.mockResolvedValue({
      data: { outcome: "notSubmitted", submitted: false },
    });
    render();
    await click("定时释放");
    selectImage();
    approve();
    await click("确认执行");
    expect(document.body.textContent).toContain("未提交变更");
    expect(button("确认执行").disabled).toBe(true);
    expect(document.body.textContent).not.toContain("查询操作收据");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
