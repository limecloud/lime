import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { accountFixture, seedCloudAccount } from "@/test/cloudAccountFixture";
import { readCloudAccount } from "@/lib/cloudAccount";
import { UserCenterSessionSettings } from ".";

vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser: vi.fn().mockResolvedValue(undefined),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  await changeLimeLocale("zh-CN");
});

async function renderPage() {
  await act(async () => root.render(<UserCenterSessionSettings />));
}

function button(text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(found, text).toBeInstanceOf(HTMLButtonElement);
  return found!;
}

describe("UserCenterSessionSettings", () => {
  it("未配置时禁用登录并显示服务状态", async () => {
    accountFixture.serviceUrl = null;
    await readCloudAccount();
    await renderPage();
    expect(button("Sign in").disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Account service is not configured",
    );
  });

  it("通过原生 public Client 登录并传递当前语言", async () => {
    await renderPage();
    await act(async () => button("Sign in").click());
    expect(accountFixture.login).toHaveBeenCalledExactlyOnceWith({
      type: "cloud",
      resource: "default",
      language: "en-US",
    });
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it.each([
    ["zh-CN", "账号服务配置无效"],
    ["zh-TW", "帳號服務設定無效"],
    ["en-US", "Account service configuration is invalid"],
    ["ja-JP", "アカウントサービスの設定が無効です"],
    ["ko-KR", "계정 서비스 설정이 잘못되었습니다"],
  ])("%s 无效服务配置在注销后保留正确的未登录状态", async (locale, message) => {
    await seedCloudAccount();
    await renderPage();
    accountFixture.serviceUrl = null;
    accountFixture.serviceError = "account_config_invalid";
    await act(async () => button("Sign out").click());
    expect(button("Sign in").disabled).toBe(true);
    await act(async () => changeLimeLocale(locale));
    expect(container.textContent).not.toContain("Test User");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(message);
  });

  it("展示各资源授权状态，注销后清除账号投影", async () => {
    await seedCloudAccount({
      resources: [
        {
          resource: "market",
          status: "connected",
          expiresAt: "2026-11-13T00:00:00Z",
          audience: "urn:lime:api:lime:sandbox:market",
          scope: "openid ecosystem.catalog.read ecosystem.acquire",
        },
      ],
    });
    await renderPage();
    expect(container.textContent).toContain("Test User");
    expect(container.textContent).toContain("Shared marketplaceAuthorized");
    expect(container.textContent).toContain("Web servicesNot authorized");
    const web = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === "Authorize",
    )[0];
    await act(async () => web.click());
    expect(accountFixture.login).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "web" }),
    );
    await act(async () => button("Sign out").click());
    expect(accountFixture.logout).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Test User");
    expect(button("Sign in")).toBeDefined();
  });

  it.each(["pending", "exchanging", "outcome_unknown"] as const)(
    "%s 时只查询原授权，不重复发起登录",
    async (status) => {
      accountFixture.authorizations = [
        {
          id: "original-authorization",
          resource: "default",
          status,
          expiresAt: "2026-11-13T00:00:00Z",
        },
      ];
      await readCloudAccount();
      await renderPage();
      expect(button("Sign in").disabled).toBe(true);
      await act(async () => button("Check status").click());
      expect(accountFixture.read).toHaveBeenLastCalledWith({
        authorizationId: "original-authorization",
      });
      expect(accountFixture.login).not.toHaveBeenCalled();
      await act(async () => button("Cancel sign-in").click());
      expect(accountFixture.logout).toHaveBeenCalledOnce();
      expect(button("Sign in").disabled).toBe(false);
    },
  );

  it("未知资源授权不重新申请，其他资源可以独立授权", async () => {
    accountFixture.authorizations = [
      {
        id: "market-original",
        resource: "market",
        status: "outcome_unknown",
        expiresAt: "2026-11-13T00:00:00Z",
      },
    ];
    await seedCloudAccount();
    await renderPage();
    const actions = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === "Authorize",
    );
    expect(actions.map((b) => b.disabled)).toEqual([true, false, false]);
    await act(async () => button("Check status").click());
    expect(accountFixture.read).toHaveBeenLastCalledWith({
      authorizationId: "market-original",
    });
    expect(accountFixture.login).not.toHaveBeenCalled();
  });

  it("Production 连接通过具体安装授权，不显示泛授权按钮", async () => {
    await seedCloudAccount({ environment: "production" });
    await renderPage();
    expect(container.textContent).toContain("Connections");
    expect(
      [...container.querySelectorAll("button")].filter(
        (b) => b.textContent === "Authorize",
      ),
    ).toHaveLength(2);
  });

  it("原生请求失败后给出可恢复反馈", async () => {
    accountFixture.login.mockRejectedValueOnce(new Error("native unavailable"));
    await renderPage();
    await act(async () => button("Sign in").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Request failed. Try again later.",
    );
    expect(button("Sign in").disabled).toBe(false);
  });

  it.each([
    ["zh-CN", "登录"],
    ["zh-TW", "登入"],
    ["en-US", "Sign in"],
    ["ja-JP", "ログイン"],
    ["ko-KR", "로그인"],
  ])("%s 使用当前语言文案", async (locale, label) => {
    await changeLimeLocale(locale);
    await renderPage();
    expect(button(label)).toBeDefined();
    expect(container.textContent).not.toMatch(/settings\.cloudAccount|·/);
  });
});
