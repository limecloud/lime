import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SshConnectionDialog } from "./SshConnectionDialog";

const api = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/lib/api/sshConnections", () => ({
  addSshConnection: api.add,
}));

let root: Root;
let container: HTMLDivElement;
const onAdded = vi.fn();
const onOpenChange = vi.fn();

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>("input")];
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
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <SshConnectionDialog
        open
        onOpenChange={onOpenChange}
        onAdded={onAdded}
      />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SshConnectionDialog", () => {
  it("填写表单后调用添加接口并回调", async () => {
    const connection = {
      alias: "prod",
      hostName: "10.0.0.1",
      user: "deploy",
      port: 2222,
    };
    api.add.mockResolvedValue(connection);
    const [alias, hostName, user, port] = inputs();
    await setValue(alias, "prod");
    await setValue(hostName, "10.0.0.1");
    await setValue(user, "deploy");
    await setValue(port, "2222");
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(api.add).toHaveBeenCalledWith({
      alias: "prod",
      hostName: "10.0.0.1",
      user: "deploy",
      port: 2222,
    });
    expect(onAdded).toHaveBeenCalledWith(connection);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("仅在必填项填写后可保存，失败显示错误", async () => {
    api.add.mockRejectedValue(new Error("dup"));
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const [alias, hostName] = inputs();
    await setValue(alias, "prod");
    await setValue(hostName, "10.0.0.1");
    expect(save.disabled).toBe(false);
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("无法添加 SSH 连接");
    expect(onAdded).not.toHaveBeenCalled();
  });
});
