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
  readContactAutofillData: api.read,
  saveContactAutofillData: api.save,
  clearContactAutofillData: api.clear,
}));

const data = {
  emails: ["alice@example.com"],
  phones: ["123456"],
  addresses: ["1 Main St"],
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

async function mount() {
  await act(async () =>
    root.render(<ContactAutofillDialog open onOpenChange={onOpenChange} />),
  );
  await act(async () => Promise.resolve());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.read.mockResolvedValue(null);
  api.save.mockResolvedValue(data);
  api.clear.mockResolvedValue(true);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await mount();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ContactAutofillDialog", () => {
  it("加载多个邮箱/电话/地址并保存编辑", async () => {
    api.read.mockResolvedValue(data);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    const inputs = [...document.querySelectorAll<HTMLInputElement>("input")];
    expect(inputs.map((input) => input.value)).toEqual([
      "alice@example.com",
      "",
      "123456",
      "",
      "1 Main St",
      "",
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
      emails: ["alice@example.com"],
      phones: ["999"],
      addresses: ["1 Main St"],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("添加并移除条目", async () => {
    await mount();
    const inputs = [...document.querySelectorAll<HTMLInputElement>("input")];
    await setValue(inputs[0], "bob@example.com");
    const add = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "添加",
    )[0];
    await act(async () => add.click());
    const afterAdd = [...document.querySelectorAll<HTMLInputElement>("input")];
    expect(afterAdd.map((input) => input.value)).toContain("bob@example.com");
    const remove = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "移除",
    )!;
    await act(async () => remove.click());
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].map(
        (input) => input.value,
      ),
    ).not.toContain("bob@example.com");
  });

  it("清除联系信息后输入框清空", async () => {
    api.read.mockResolvedValue(data);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
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
    ).toEqual(["", "", ""]);
  });

  it("邮箱格式无效时提示并禁用保存", async () => {
    api.read.mockResolvedValue(data);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    const [email] = [...document.querySelectorAll<HTMLInputElement>("input")];
    await setValue(email, "not-an-email");
    expect(document.body.textContent).toContain("邮箱格式无效");
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await setValue(email, "alice@example.com");
    expect(save.disabled).toBe(false);
  });

  it("保存失败显示错误", async () => {
    api.save.mockRejectedValue(new Error("nope"));
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
