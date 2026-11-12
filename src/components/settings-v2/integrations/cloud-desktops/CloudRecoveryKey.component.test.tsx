import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudArchivePanel } from "./CloudArchivePanel";

const api = vi.hoisted(() => ({ save: vi.fn(), available: vi.fn() }));
vi.mock("@/lib/desktop-host/dialog", () => ({ save: api.save }));
vi.mock("@/lib/electron-host", () => ({
  isElectronHostCommandAvailable: api.available,
}));

let root: Root;
let container: HTMLDivElement;
const recipient = `age1${"a".repeat(58)}`;
const request = vi.fn();
const keyPath = "/offline/recovery.agekey";
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
function button() {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === "创建恢复密钥",
  )!;
}
function field(label: string) {
  return Array.from(container.querySelectorAll("label"))
    .find((item) => item.querySelector("span")?.textContent === label)!
    .querySelector("input")!;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  api.available.mockReturnValue(true);
  api.save.mockResolvedValue(keyPath);
  request.mockResolvedValue({ data: { identityFile: keyPath, recipient } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(<CloudArchivePanel request={request} computers={[]} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("creates a local key through the native save dialog and fills only public metadata", async () => {
  expect(container.textContent).toContain("请另存一份离线备份");
  await act(async () => button().click());
  expect(api.save).toHaveBeenCalledExactlyOnceWith({
    title: "创建恢复密钥",
    defaultPath: "lime-cloud-recovery.agekey",
    filters: [{ name: "age", extensions: ["agekey"] }],
  });
  expect(request).toHaveBeenCalledExactlyOnceWith({
    action: "createArchiveIdentity",
    identityFile: keyPath,
  });
  expect(field("age 接收方公钥 (age1…)").value).toBe(recipient);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    keyPath,
  );
  const action = container.querySelector("select")!;
  act(() => {
    action.value = "restore";
    action.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(field("本地 age 私钥文件路径").value).toBe(keyPath);
  expect(button()).toBeUndefined();
});

it("cancels without a request or a success message", async () => {
  api.save.mockResolvedValue(null);
  await act(async () => button().click());
  expect(request).not.toHaveBeenCalled();
  expect(field("age 接收方公钥 (age1…)").value).toBe("");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector("fieldset")!.disabled).toBe(false);
});

it("blocks duplicate clicks and export while selecting a destination or saving", async () => {
  let choose!: (value: string) => void;
  let finish!: (value: unknown) => void;
  api.save.mockReturnValue(
    new Promise((resolve) => {
      choose = resolve;
    }),
  );
  request.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const create = button();
  act(() => {
    create.click();
    create.click();
  });
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  await act(async () => choose(keyPath));
  expect(request).toHaveBeenCalledTimes(1);
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  await act(async () => finish({ data: { identityFile: keyPath, recipient } }));
  expect(container.querySelector("fieldset")!.disabled).toBe(false);
  expect(field("age 接收方公钥 (age1…)").value).toBe(recipient);
});

it.each(["rejected", "invalid"])(
  "preserves the current recipient on %s and hides raw errors",
  async (kind) => {
    const input = field("age 接收方公钥 (age1…)");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "existing-recipient");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (kind === "rejected")
      request.mockRejectedValue(new Error("synthetic-private-material"));
    else
      request.mockResolvedValue({
        data: { identityFile: keyPath, recipient: "AGE-SECRET-KEY-synthetic" },
      });
    await act(async () => button().click());
    expect(input.value).toBe("existing-recipient");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "请检查所选位置",
    );
    expect(container.textContent).not.toContain("synthetic");
    expect(container.querySelector("fieldset")!.disabled).toBe(false);
  },
);

it("does not create a key if the page closes during the native dialog", async () => {
  let choose!: (value: string) => void;
  api.save.mockReturnValue(
    new Promise((resolve) => {
      choose = resolve;
    }),
  );
  act(() => button().click());
  act(() => root.render(<div />));
  await act(async () => choose(keyPath));
  expect(request).not.toHaveBeenCalled();
});

it("offers key creation only in the local Desktop", async () => {
  api.available.mockReturnValue(false);
  act(() =>
    root.render(<CloudArchivePanel request={request} computers={[]} />),
  );
  await settle();
  expect(button()).toBeUndefined();
  expect(api.save).not.toHaveBeenCalled();
});
