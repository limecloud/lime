import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { BrowserPasswordsDialog } from "./BrowserPasswordsDialog";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock("@/lib/api/browserPasswords", () => ({
  listBrowserPasswords: api.list,
  saveBrowserPassword: api.save,
  removeBrowserPassword: api.remove,
  revealBrowserPassword: api.reveal,
}));

const item = {
  id: "p1",
  origin: "https://example.com",
  username: "alice",
  updatedAt: 1,
};

let root: Root;
let container: HTMLDivElement;

async function mount(open = true) {
  await act(async () =>
    root.render(
      <BrowserPasswordsDialog open={open} onOpenChange={() => undefined} />,
    ),
  );
  await act(async () => Promise.resolve());
}

function buttons(text: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement[];
}

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
  api.list.mockResolvedValue([]);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BrowserPasswordsDialog", () => {
  it("空态与添加密码", async () => {
    await mount();
    expect(document.body.textContent).toContain("尚未保存密码");
    const dialog = document.querySelector(
      "[data-testid=browser-passwords-dialog]",
    )!;
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>("input")];
    expect(inputs).toHaveLength(3);
    await setValue(inputs[0], "example.com");
    await setValue(inputs[1], "alice");
    await setValue(inputs[2], "secret");
    api.save.mockResolvedValue(item);
    api.list.mockResolvedValue([item]);
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(api.save).toHaveBeenCalledWith({
      origin: "https://example.com",
      username: "alice",
      password: "secret",
    });
    expect(document.body.textContent).toContain("example.com");
  });

  it("网站地址非法时禁用保存", async () => {
    await mount();
    const dialog = document.querySelector(
      "[data-testid=browser-passwords-dialog]",
    )!;
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>("input")];
    await setValue(inputs[0], "not a url");
    await setValue(inputs[1], "alice");
    await setValue(inputs[2], "secret");
    expect(document.body.textContent).toContain("网站地址无效");
    const save = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("显示/隐藏密码与确认移除", async () => {
    api.list.mockResolvedValue([item]);
    api.reveal.mockResolvedValue("secret");
    api.remove.mockResolvedValue(true);
    await mount();
    await act(async () => buttons("显示密码")[0].click());
    await act(async () => Promise.resolve());
    expect(api.reveal).toHaveBeenCalledWith("p1");
    expect(document.body.textContent).toContain("secret");
    expect(buttons("隐藏密码")).toHaveLength(1);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await act(async () => buttons("复制密码")[0].click());
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenCalledWith("secret");
    expect(buttons("已复制")).toHaveLength(1);

    await act(async () => buttons("移除")[0].click());
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("移除已保存的密码？");
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
      (candidate) =>
        candidate.textContent?.includes("移除已保存的密码？") ?? false,
    )!;
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "移除",
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    await act(async () => Promise.resolve());
    expect(api.remove).toHaveBeenCalledWith("p1");
  });

  it("编辑已有密码时回填并保存新密码", async () => {
    api.list.mockResolvedValue([item]);
    api.save.mockResolvedValue(item);
    await mount();
    await act(async () => buttons("编辑")[0].click());
    await act(async () => Promise.resolve());
    const dialog = document.querySelector(
      "[data-testid=browser-passwords-dialog]",
    )!;
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>("form input")];
    expect(inputs.map((input) => input.value)).toEqual([
      "https://example.com",
      "alice",
      "",
    ]);
    await setValue(inputs[2], "new-secret");
    await act(async () =>
      dialog
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(api.save).toHaveBeenCalledWith({
      origin: "https://example.com",
      username: "alice",
      password: "new-secret",
    });
  });

  it("按网站或用户名过滤密码", async () => {
    api.list.mockResolvedValue([
      item,
      {
        id: "p2",
        origin: "https://other.example.com",
        username: "bob",
        updatedAt: 2,
      },
    ]);
    await mount();
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    await setValue(search, "bob");
    expect(document.querySelectorAll("li")).toHaveLength(1);
    expect(document.body.textContent).toContain("other.example.com");
    await setValue(search, "zzz");
    expect(document.body.textContent).toContain("没有匹配的密码");
  });

  it("加载失败显示错误", async () => {
    api.list.mockRejectedValue(new Error("nope"));
    await mount();
    expect(document.body.textContent).toContain("无法加载已保存的密码");
  });
});
