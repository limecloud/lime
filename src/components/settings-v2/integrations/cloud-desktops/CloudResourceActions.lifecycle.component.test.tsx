import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudDesktopParams,
  CloudDesktopResource,
} from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudResourceActions } from "./CloudResourceActions";
import { CloudReceipt } from "./CloudDesktopPrimitives";

const savedWork = "我已保存工作，并停止正在写入文件的任务。";
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

async function render(status: string, target = resource, disabled = false) {
  await act(async () => {
    root.render(
      <CloudResourceActions
        resource={target}
        status={status}
        disabled={disabled}
        request={request}
        onChanged={onChanged}
      />,
    );
  });
}

function button(text: string) {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const found = Array.from(scope.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, `missing button: ${text}`).toBeTruthy();
  return found!;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

async function saveWork() {
  const input = Array.from(document.querySelectorAll("label"))
    .find((element) => element.textContent?.trim() === savedWork)
    ?.querySelector("input");
  expect(input).toBeTruthy();
  await act(async () => input!.click());
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  request.mockImplementation(async (params: CloudDesktopParams) => ({
    data: {
      outcome: "unknown",
      operationId: "operationId" in params ? params.operationId : undefined,
    },
  }));
  await changeLimeLocale("zh-CN");
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

describe("cloud desktop lifecycle confirmation", () => {
  for (const provider of ["ecs", "wuying"] as const) {
    const target = {
      ...resource,
      provider,
      resourceId: provider === "ecs" ? "i-test" : "ecd-test",
    };

    it(`${provider}: starts the shown target without entering a technical ID`, async () => {
      await render("Stopped", target);
      await click("启动");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        target.resourceId,
      );
      expect(document.querySelector('[role="dialog"] input')).toBeNull();
      expect(button("确认执行").disabled).toBe(false);
      expect(request).not.toHaveBeenCalled();
      await act(async () => {
        button("确认执行").click();
        button("确认执行").click();
      });
      expect(request).toHaveBeenCalledExactlyOnceWith({
        action: "start",
        resource: target,
        operationId: expect.any(String),
        confirmation: `start:cn-test:${target.resourceId}`,
      });
    });

    it(`${provider}: stops only after saved-work consent without typing an ID`, async () => {
      await render("Running", target);
      await click("停机保留磁盘");
      const inputs = document.querySelectorAll('[role="dialog"] input');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].getAttribute("type")).toBe("checkbox");
      expect(button("确认执行").disabled).toBe(true);
      await saveWork();
      expect(button("确认执行").disabled).toBe(false);
      await click("确认执行");
      expect(request).toHaveBeenCalledExactlyOnceWith({
        action: "stop",
        resource: target,
        operationId: expect.any(String),
        confirmation: `stop:cn-test:${target.resourceId}`,
        workSaved: true,
      });
    });
  }

  it.each(["resourceId", "profile", "regionId", "provider"] as const)(
    "discards unsubmitted consent when %s changes",
    async (field) => {
      await render("Running");
      await click("停机保留磁盘");
      await saveWork();
      const updated: CloudDesktopResource = {
        ...resource,
        [field]: field === "provider" ? "wuying" : "changed",
      };
      await render("Running", updated);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(request).not.toHaveBeenCalled();
      await click("停机保留磁盘");
      expect(button("确认执行").disabled).toBe(true);
      await saveWork();
      await click("确认执行");
      expect(request).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ resource: updated }),
      );
    },
  );

  it.each(["status", "disabled"])(
    "requires fresh consent after %s changes and returns",
    async (change) => {
      await render("Running");
      await click("停机保留磁盘");
      await saveWork();
      await render(
        change === "status" ? "Stopping" : "Running",
        resource,
        change === "disabled",
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await render("Running");
      await click("停机保留磁盘");
      expect(button("确认执行").disabled).toBe(true);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("continues the original receipt when the request result is unknown", async () => {
    await render("Running");
    await click("停机保留磁盘");
    await saveWork();
    await click("确认执行");
    const original = request.mock.calls[0][0];
    await render("Stopping", resource, true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click("查询操作收据");
    expect(request.mock.calls.map(([params]) => params)).toEqual([
      original,
      { action: "readOperation", operationId: original.operationId },
    ]);
  });

  it("allows the next action after the original unknown operation is verified", async () => {
    await render("Running");
    await click("停机保留磁盘");
    await saveWork();
    await click("确认执行");
    const original = request.mock.calls[0][0];
    request.mockResolvedValueOnce({
      data: {
        operationId: original.operationId,
        outcome: "lifecycleVerified",
        requiresInspection: false,
        observedAfter: { status: "Stopped", computeReleased: true },
      },
    });
    await render("Stopped");
    await click("查询操作收据");
    await click("关闭");
    expect(button("启动")).toBeTruthy();
    await click("启动");
    expect(document.querySelector('[role="dialog"] input')).toBeNull();
    await click("确认执行");
    const next = request.mock.calls[2][0];
    expect(next.action).toBe("start");
    expect(next.operationId).not.toBe(original.operationId);
    expect(request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: original.operationId,
    });
  });

  it("automatically reads the original lifecycle intent until it is verified", async () => {
    await render("Running");
    await click("停机保留磁盘");
    await saveWork();
    vi.useFakeTimers();
    await click("确认执行");
    const original = request.mock.calls[0][0];
    request.mockResolvedValueOnce({
      data: {
        operationId: original.operationId,
        outcome: "accepted",
        requiresInspection: true,
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await render("Stopped");
    expect(container.textContent).toContain("查询操作收据");
    request.mockResolvedValueOnce({
      data: {
        operationId: original.operationId,
        outcome: "lifecycleVerified",
        requiresInspection: false,
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(request.mock.calls.map(([params]) => params)).toEqual([
      original,
      { action: "readOperation", operationId: original.operationId },
      { action: "readOperation", operationId: original.operationId },
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("stops automatic reads on an error and keeps the same intent for manual recovery", async () => {
    await render("Stopped");
    await click("启动");
    vi.useFakeTimers();
    await click("确认执行");
    const original = request.mock.calls[0][0];
    request.mockRejectedValueOnce(new Error("read unavailable"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(request).toHaveBeenCalledTimes(2);
    await click("查询操作收据");
    expect(request.mock.calls[2][0]).toEqual({
      action: "readOperation",
      operationId: original.operationId,
    });
  });

  it.each([
    ["zh-CN", "云端已确认电脑到达目标状态"],
    ["zh-TW", "雲端已確認電腦到達目標狀態"],
    [
      "en-US",
      "The cloud confirmed that this computer reached the requested state",
    ],
    ["ja-JP", "クラウドでパソコンが指定の状態になったことを確認しました"],
    ["ko-KR", "클라우드에서 컴퓨터가 요청한 상태에 도달했음을 확인했습니다"],
  ])(
    "%s: lifecycle verification describes the provider observation",
    async (locale, text) => {
      await changeLimeLocale(locale);
      await act(async () => {
        root.render(<CloudReceipt data={{ outcome: "lifecycleVerified" }} />);
      });
      expect(container.textContent).toContain(text);
    },
  );
});
