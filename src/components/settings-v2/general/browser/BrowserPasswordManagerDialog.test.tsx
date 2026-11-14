import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { BrowserPasswordManagerDialog } from "./BrowserPasswordManagerDialog";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/lib/api/browserPasswordManager", () => ({
  getBrowserPasswordManagerProvider: api.get,
  setBrowserPasswordManagerProvider: api.set,
}));

let root: Root;
let container: HTMLDivElement;
let open = true;

async function mount() {
  await act(async () =>
    root.render(
      <BrowserPasswordManagerDialog
        open={open}
        onOpenChange={(next) => {
          open = next;
        }}
      />,
    ),
  );
  await act(async () => Promise.resolve());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  open = true;
  api.get.mockResolvedValue(null);
  api.set.mockResolvedValue("openai");
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BrowserPasswordManagerDialog", () => {
  it("选择并保存外部密码管理器", async () => {
    await mount();
    expect(document.body.textContent).toContain("选择密码管理器");
    const openai = [...document.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("OpenAI 密码"),
    )!;
    const radio = openai.querySelector("input")!;
    await act(async () => radio.click());
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    )!;
    await act(async () => save.click());
    await act(async () => Promise.resolve());
    expect(api.set).toHaveBeenCalledWith("openai");
    expect(open).toBe(false);
  });

  it("加载已保存的选择", async () => {
    api.get.mockResolvedValue("onepassword");
    await mount();
    const checked = document.querySelector<HTMLInputElement>(
      'input[type="radio"]:checked',
    );
    expect(checked).not.toBeNull();
    expect(checked!.closest("label")?.textContent).toContain("1Password");
  });

  it("保存失败提示错误", async () => {
    api.set.mockRejectedValueOnce(new Error("boom"));
    await mount();
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    )!;
    await act(async () => save.click());
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("无法保存密码管理器选择");
  });
});
