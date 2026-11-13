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
function Harness({ initialProfile = "" }: { initialProfile?: string }) {
  const [selected, setSelected] = useState(initialProfile);
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
  it.each([
    ["zh-CN", "阿里云国内站（CN）", "账号尾号 8819"],
    ["zh-TW", "阿里雲中國站（CN）", "帳號末四碼 8819"],
    ["en-US", "Alibaba Cloud China site (CN)", "Account ending in 8819"],
    ["ja-JP", "Alibaba Cloud 中国サイト（CN）", "アカウント末尾 8819"],
    ["ko-KR", "Alibaba Cloud 중국 사이트(CN)", "계정 끝 4자리 8819"],
  ])(
    "%s 显示明确站点和经验证的账号尾号，读取不重新授权",
    async (locale, site, account) => {
      await changeLimeLocale(locale);
      state = { status: "connected", profile, accountIdSuffix: "8819" };
      act(() => root.render(<Harness />));
      await settle();
      expect(container.textContent).toContain(site);
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        account,
      );
      expect(container.textContent).not.toContain("settings.cloudDesktop.");
      expect(connected).toHaveBeenCalledExactlyOnceWith(profile);
      expect(api.request.mock.calls.map(([request]) => request.action)).toEqual(
        ["readAlibabaConnection"],
      );
    },
  );

  it("旧连接明确显示账号信息缺失，不猜尾号且不自动启动授权", async () => {
    state = { status: "connected", profile };
    act(() => root.render(<Harness />));
    await settle();
    expect(container.textContent).toContain("此连接未记录账号尾号");
    expect(container.textContent).not.toContain("8819");
    expect(container.querySelector("button")?.textContent).toBe(
      "切换阿里云账号",
    );
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("切换清空原选择，验证完成前不展示旧身份，完成后只选择新账号", async () => {
    state = { status: "connected", profile, accountIdSuffix: "8819" };
    act(() => root.render(<Harness />));
    await settle();
    const next = `lime-oauth-${"b".repeat(32)}`;
    state = { status: "authorizing", profile: next };
    act(() => {
      container.querySelector("button")!.click();
      container.querySelector("button")!.click();
    });
    await settle();
    expect(connected).toHaveBeenLastCalledWith("");
    expect(container.textContent).not.toContain("8819");
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.action === "connectAlibaba",
      ),
    ).toHaveLength(1);
    state = { status: "verifying", profile: next };
    await tick();
    expect(connected).toHaveBeenLastCalledWith("");
    state = { status: "connected", profile: next, accountIdSuffix: "7728" };
    await tick();
    expect(connected).toHaveBeenLastCalledWith(next);
    expect(container.textContent).toContain("账号尾号 7728");
    expect(container.textContent).not.toContain("8819");
  });

  it("当前所选 profile 与授权不同，不将另一账号显示为已选账号", async () => {
    state = { status: "connected", profile, accountIdSuffix: "8819" };
    const previous = `lime-oauth-${"c".repeat(32)}`;
    act(() => root.render(<Harness initialProfile={previous} />));
    await settle();
    expect(connected).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("8819");
    expect(container.textContent).not.toContain("阿里云已连接");
  });

  it.each(["success", "failure"])(
    "切换期间迟到的原读取 %s 不覆盖新授权或重新选中旧账号",
    async (outcome) => {
      let complete!: (value: unknown) => void;
      let fail!: (reason: Error) => void;
      api.request.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            complete = resolve;
            fail = reject;
          }),
      );
      act(() => root.render(<Harness />));
      await settle();
      const next = `lime-oauth-${"b".repeat(32)}`;
      state = { status: "authorizing", profile: next };
      act(() => container.querySelector("button")!.click());
      await settle();
      await act(async () => {
        if (outcome === "failure") fail(new Error("late read failed"));
        else
          complete({
            data: { status: "connected", profile, accountIdSuffix: "8819" },
          });
      });
      await settle();
      expect(connected).toHaveBeenLastCalledWith("");
      expect(container.textContent).not.toContain("8819");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector("button")?.disabled).toBe(true);
      state = { status: "connected", profile: next, accountIdSuffix: "7728" };
      await tick();
      expect(connected).toHaveBeenLastCalledWith(next);
    },
  );

  it.each(["1000000000008819", "8819\n", "secret", "１２３４"])(
    "非法尾号 %j 不进入账号显示或选择，失败只允许重新读取",
    async (suffix) => {
      state = { status: "connected", profile, accountIdSuffix: suffix };
      act(() => root.render(<Harness />));
      await settle();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "无法读取阿里云连接状态",
      );
      expect(connected).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(suffix);
      act(() => container.querySelector("button")!.click());
      await settle();
      expect(
        api.request.mock.calls.every(
          ([request]) => request.action === "readAlibabaConnection",
        ),
      ).toBe(true);
    },
  );

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
