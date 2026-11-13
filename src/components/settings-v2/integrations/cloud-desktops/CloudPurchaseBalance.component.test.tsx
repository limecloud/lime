import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudReceipt } from "./CloudDesktopPrimitives";

let root: Root;
let container: HTMLDivElement;
const receipt = {
  operationId: "not-submitted-test",
  outcome: "notSubmitted",
  submitted: false,
  requiresInspection: false,
  providerCode: "InvalidAccountStatus.NotEnoughBalance",
  diagnostic: "Cloud request failed; inspect resource before retrying",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
  vi.unstubAllGlobals();
});

describe("采购资金拒绝后的恢复指引", () => {
  it.each([
    ["zh-CN", "补足资金或切换账号"],
    ["zh-TW", "補足資金或切換帳號"],
    ["en-US", "Add funds or switch accounts"],
    ["ja-JP", "入金するかアカウントを切り替え"],
    ["ko-KR", "충전하거나 계정을 전환"],
  ])("%s 为明确未下单的余额拒绝显示恢复动作", async (locale, guidance) => {
    await changeLimeLocale(locale);
    act(() => root.render(<CloudReceipt data={receipt} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      guidance,
    );
    expect(container.textContent).not.toContain(receipt.diagnostic);
    expect(container.textContent).not.toContain(receipt.providerCode);
    expect(container.textContent).toContain(receipt.operationId);
  });

  it.each([
    { outcome: "unknown", submitted: true, requiresInspection: true },
    { outcome: "accepted", submitted: true, requiresInspection: true },
    { submitted: undefined },
    { requiresInspection: true },
    { providerCode: "InvalidAccountStatus.NotEnoughBalance.Other" },
    { providerCode: undefined, diagnostic: receipt.providerCode },
  ])("未证明未下单时不提示重新购买：%j", async (change) => {
    await changeLimeLocale("zh-CN");
    const data = { ...receipt, ...change };
    act(() => root.render(<CloudReceipt data={data} />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(data.diagnostic);
    expect(container.textContent).not.toContain("补足资金或切换账号");
  });
});
