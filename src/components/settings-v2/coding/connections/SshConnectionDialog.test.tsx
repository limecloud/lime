import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SshConnectionDialog } from "./SshConnectionDialog";

const api = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/api/sshConnections", () => ({
  addSshConnection: api.add,
  updateSshConnection: api.update,
}));

let root: Root;
let container: HTMLDivElement;
const onSaved = vi.fn();
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
        onSaved={onSaved}
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
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("编辑模式回填并更新连接", async () => {
    api.update.mockResolvedValue(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(
        <SshConnectionDialog
          open
          initial={{
            alias: "prod",
            hostName: "1.1.1.1",
            user: "old",
            port: 22,
          }}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />,
      ),
    );
    const fields = inputs();
    expect(fields.map((input) => input.value)).toEqual([
      "prod",
      "1.1.1.1",
      "old",
      "22",
    ]);
    expect(fields[0].disabled).toBe(true);
    expect(document.body.textContent).toContain("编辑 SSH 连接");
    await setValue(fields[1], "10.0.0.1");
    await setValue(fields[2], "deploy");
    await setValue(fields[3], "2222");
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => Promise.resolve());
    expect(api.update).toHaveBeenCalledWith("prod", {
      hostName: "10.0.0.1",
      user: "deploy",
      port: 2222,
    });
    expect(onSaved).toHaveBeenCalled();
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
    expect(onSaved).not.toHaveBeenCalled();
  });
});
