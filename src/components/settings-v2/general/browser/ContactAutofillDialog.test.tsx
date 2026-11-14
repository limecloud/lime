import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ContactAutofillDialog } from "./ContactAutofillDialog";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/lib/api/contactAutofill", () => ({
  readContactAutofillProfile: api.read,
  saveContactAutofillProfile: api.save,
  clearContactAutofillProfile: api.clear,
}));

const profile = {
  fullName: "Alice",
  email: "alice@example.com",
  phone: "123456",
  address: "1 Main St",
};

let root: Root;
let container: HTMLDivElement;
const onOpenChange = vi.fn();

async function setValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.read.mockResolvedValue(null);
  api.save.mockResolvedValue(profile);
  api.clear.mockResolvedValue(true);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<ContactAutofillDialog open onOpenChange={onOpenChange} />),
  );
  await act(async () => Promise.resolve());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ContactAutofillDialog", () => {
  it("加载并保存联系信息", async () => {
    api.read.mockResolvedValue(profile);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(<ContactAutofillDialog open onOpenChange={onOpenChange} />),
    );
    await act(async () => Promise.resolve());
    const inputs = [...document.querySelectorAll<HTMLInputElement>("input")];
    expect(inputs.map((input) => input.value)).toEqual([
      "Alice",
      "alice@example.com",
      "123456",
      "1 Main St",
    ]);
    await setValue(inputs[2], "999");
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(api.save).toHaveBeenCalledWith({
      fullName: "Alice",
      email: "alice@example.com",
      phone: "999",
      address: "1 Main St",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("清除联系信息后输入框清空", async () => {
    api.read.mockResolvedValue(profile);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(<ContactAutofillDialog open onOpenChange={onOpenChange} />),
    );
    await act(async () => Promise.resolve());
    const clear = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "清除联系信息",
    )!;
    await act(async () => clear.click());
    await act(async () => Promise.resolve());
    const confirmDialog = [
      ...document.querySelectorAll('[role="dialog"]'),
    ].find(
      (candidate) => candidate.textContent?.includes("清除联系信息？") ?? false,
    )!;
    const confirm = [...confirmDialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "清除联系信息",
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    await act(async () => Promise.resolve());
    expect(api.clear).toHaveBeenCalled();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].map(
        (input) => input.value,
      ),
    ).toEqual(["", "", "", ""]);
  });

  it("邮箱格式无效时提示并禁用保存", async () => {
    const [, email] = [...document.querySelectorAll<HTMLInputElement>("input")];
    await setValue(email, "not-an-email");
    expect(document.body.textContent).toContain("邮箱格式无效");
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await setValue(email, "alice@example.com");
    expect(save.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("邮箱格式无效");
  });

  it("保存失败显示错误", async () => {
    api.save.mockRejectedValue(new Error("nope"));
    const [name] = [...document.querySelectorAll<HTMLInputElement>("input")];
    await setValue(name, "Alice");
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("无法保存联系信息");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
