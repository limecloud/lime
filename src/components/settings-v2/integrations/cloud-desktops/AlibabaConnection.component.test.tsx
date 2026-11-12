import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { AlibabaConnection } from "./AlibabaConnection";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
const profile = `lime-oauth-${"a".repeat(32)}`;
const connected = vi.fn();
const authorizing = vi.fn();
let state: Record<string, unknown>;
let root: Root;
let container: HTMLDivElement;
function Harness() {
  const [selected, setSelected] = useState("");
  return (
    <AlibabaConnection
      regionId="cn-hangzhou"
      profile={selected}
      locked={false}
      onConnected={(value) => {
        connected(value);
        setSelected(value);
      }}
      onAuthorizingChange={authorizing}
    />
  );
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  await settle();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await changeLimeLocale("zh-CN");
  state = { status: "preparing", profile };
  connected.mockReset();
  authorizing.mockReset();
  api.request.mockReset();
  api.request.mockImplementation(async () => ({ data: { ...state } }));
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

describe("Lime 自动准备与验证阿里云连接", () => {
  it("重开后继续准备、授权与验证，实际可用前保持锁定且不重开授权", async () => {
    act(() => root.render(<Harness />));
    await settle();
    expect(container.textContent).toContain("正在准备授权环境");
    expect(container.querySelector("button")?.disabled).toBe(true);
    state = { status: "authorizing", profile };
    await tick();
    expect(container.textContent).toContain("请在浏览器完成阿里云授权");
    state = { status: "verifying", profile };
    await tick();
    expect(container.textContent).toContain("正在验证云账号连接");
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(connected).not.toHaveBeenCalled();
    expect(authorizing).toHaveBeenLastCalledWith(true);
    state = { status: "connected", profile };
    await tick();
    expect(container.textContent).toContain("阿里云已连接");
    expect(connected).toHaveBeenCalledExactlyOnceWith(profile);
    expect(authorizing).toHaveBeenLastCalledWith(false);
    expect(
      api.request.mock.calls.every(
        ([request]) => request.action === "readAlibabaConnection",
      ),
    ).toBe(true);
  });

  it("验证失败提供连接重试，沿原授权恢复且只提交一次", async () => {
    state = { status: "failed", profile, errorCode: "verificationFailed" };
    act(() => root.render(<Harness />));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "复用本次授权",
    );
    const retry = container.querySelector("button")!;
    expect(retry.textContent).toBe("重试连接");
    state = { status: "verifying", profile };
    act(() => {
      retry.click();
      retry.click();
    });
    await settle();
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.action === "connectAlibaba",
      ),
    ).toHaveLength(1);
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    state = { status: "connected", profile };
    await tick();
    expect(connected).toHaveBeenLastCalledWith(profile);
  });

  it.each([
    ["zh-CN", "正在验证云账号连接"],
    ["zh-TW", "正在驗證雲端帳號連線"],
    ["en-US", "Verifying your cloud connection"],
    ["ja-JP", "クラウド接続を確認"],
    ["ko-KR", "클라우드 연결을 확인"],
  ])("%s 显示真实验证阶段", async (locale, message) => {
    await changeLimeLocale(locale);
    state = { status: "verifying", profile };
    act(() => root.render(<Harness />));
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      message,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(connected).not.toHaveBeenCalled();
  });
});
