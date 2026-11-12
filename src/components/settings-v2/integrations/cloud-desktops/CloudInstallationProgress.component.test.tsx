import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { CloudGuestInstallationStatus } from "@/lib/desktop-host/cloudDesktopConnection";
import { CloudInstallationProgress } from "./CloudInstallationProgress";
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:10:00Z"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
function render(
  phase: CloudGuestInstallationStatus["phase"],
  busy = true,
  reconnect = false,
) {
  act(() =>
    root.render(
      <CloudInstallationProgress
        reconnect={reconnect}
        status={{
          kind: "installation",
          available: true,
          exists: true,
          busy,
          phase,
          operationId: "same-operation",
          createdAt: Date.parse("2026-11-11T12:00:00Z"),
        }}
      />,
    ),
  );
}
it("投影真实阶段与原操作耗时，不使用百分比或从重开面板计时", () => {
  render("uploading");
  expect(
    container.querySelector('[aria-current="step"]')?.textContent,
  ).toContain("获取并安装运行包");
  expect(container.querySelector('[role="timer"]')?.textContent).toBe(
    "已用时 10 分 0 秒",
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(container.querySelector('[role="timer"]')?.textContent).toBe(
    "已用时 10 分 2 秒",
  );
  expect(container.textContent).toContain("请保持 Lime 运行");
  expect(container.textContent).not.toContain("%");
  render("saving");
  expect(
    container.querySelector('[aria-current="step"]')?.textContent,
  ).toContain("保存安全连接");
  expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(2);
});
it("需检查和失败不冒充成功；complete 只标完成安装", () => {
  for (const phase of ["needsAttention", "failed", "expired"] as const) {
    render(phase, false);
    expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(
      0,
    );
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
  }
  render("complete", false);
  expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(4);
  expect(container.textContent).toContain("完成安装");
  expect(container.textContent).not.toContain("Computer Use");
  expect(container.querySelector('[role="timer"]')).toBeNull();
  render("launching", true, true);
  expect(container.textContent).toBe("");
});
it("新机就绪等待保留准备步骤、原计时与自动接续说明", () => {
  render("waitingForAgent");
  expect(container.querySelector('[aria-current="step"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(0);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "连接就绪后会自动继续",
  );
  expect(container.querySelector('[role="timer"]')?.textContent).toBe(
    "已用时 10 分 0 秒",
  );
});
