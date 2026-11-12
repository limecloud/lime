import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudDesktopViewer } from "./CloudDesktopViewer";

const api = vi.hoisted(() => ({ connect: vi.fn(), password: vi.fn() }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  connectCloudDesktopView: api.connect,
  showCloudDesktopViewPassword: api.password,
}));
let root: Root;
let container: HTMLDivElement;
const close = vi.fn();
async function render() {
  await act(async () => root.render(<CloudDesktopViewer onClose={close} />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  close.mockReset();
  api.connect
    .mockReset()
    .mockResolvedValue({ endpoint: "http://127.0.0.1:12345/vnc.html" });
  api.password.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("展开后只连接桌面查看通道，使用隔离和查看模式，不自动读取密码", async () => {
  await render();
  expect(api.connect).toHaveBeenCalledTimes(1);
  const frame = container.querySelector("iframe")!;
  expect(frame).not.toBeNull();
  const url = new URL(frame.src);
  expect(url.origin).toBe("http://127.0.0.1:12345");
  expect(url.searchParams.get("view_only")).toBe("true");
  expect(url.searchParams.get("resize")).toBe("scale");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(api.password).not.toHaveBeenCalled();
  await click("收起桌面");
  expect(close).toHaveBeenCalledTimes(1);
});

it("桌面密码只有单独点击才由 Main 显示，等待中拒绝重复调用", async () => {
  api.password.mockReturnValue(new Promise(() => undefined));
  await render();
  await click("查看桌面密码");
  await click("查看桌面密码");
  expect(api.password).toHaveBeenCalledTimes(1);
  expect(container.querySelector("iframe")?.src).not.toContain("password");
});

it("任意失败消息不会进入界面，显式重试才重新连接", async () => {
  api.connect.mockRejectedValueOnce(
    new Error("https://supplier.invalid/?token=private-value"),
  );
  await render();
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "无法打开桌面查看器",
  );
  expect(container.textContent).not.toContain("private-value");
  await click("重新连接");
  expect(api.connect).toHaveBeenCalledTimes(2);
  expect(container.querySelector("iframe")).not.toBeNull();
});

it("拒绝供应商地址或带密码地址，不在 iframe 发起连接", async () => {
  api.connect.mockResolvedValue({
    endpoint: "http://127.0.0.1:12345/vnc.html?password=private-value",
  });
  await render();
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.textContent).not.toContain("private-value");
  expect(container.querySelector("[role=alert]")).not.toBeNull();
});

it("收起卸载后迟到响应不能重新挂载查看器", async () => {
  let resolve!: (value: unknown) => void;
  api.connect.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render();
  act(() => root.render(<p>Hidden</p>));
  await act(async () =>
    resolve({ endpoint: "http://127.0.0.1:12345/vnc.html" }),
  );
  expect(container.textContent).toBe("Hidden");
  expect(container.querySelector("iframe")).toBeNull();
});

it("密码显示失败保持已有画面并提供固定提示", async () => {
  api.password.mockRejectedValue(new Error("private-password"));
  await render();
  await click("查看桌面密码");
  expect(container.querySelector("iframe")).not.toBeNull();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "无法显示桌面密码",
  );
  expect(container.textContent).not.toContain("private-password");
});

it("通道就绪后仍显示加载状态，直到查看页面完成加载", async () => {
  await render();
  const frame = container.querySelector("iframe")!;
  expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "正在连接桌面查看器",
  );
  await act(async () => {
    frame.dispatchEvent(new Event("load"));
  });
  expect(container.querySelector("[role=status]")).toBeNull();
  expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe(
    "false",
  );
});
