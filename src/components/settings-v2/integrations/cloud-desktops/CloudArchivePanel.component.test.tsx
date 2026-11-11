import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudArchivePanel } from "./CloudArchivePanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: invoke,
}));
vi.mock("@/lib/electron-host", () => ({
  isElectronHostCommandAvailable: () => true,
}));

it("requires fresh consent when the destination or backup changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const request = vi.fn();
  const resource = {
    provider: "ecs" as const,
    profile: "test",
    regionId: "cn-test",
    resourceId: "i-target",
  };
  const destination = "/home/lime/lime-restored-recovered";
  invoke.mockResolvedValue({
    kind: "archiveRestore",
    destination,
    files: 1,
    requiresApplicationValidation: true,
  });
  const select = (index: number, value: string) => {
    const control = container.querySelectorAll("select")[index];
    act(() => {
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const input = (label: string, value: string) => {
    const control = Array.from(container.querySelectorAll("label"))
      .find((item) => item.querySelector("span")?.textContent === label)!
      .querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  try {
    await changeLimeLocale("zh-CN");
    act(() =>
      root.render(
        <CloudArchivePanel
          request={request}
          computers={[{ key: "target", name: "测试云电脑", resource }]}
        />,
      ),
    );
    select(0, "restoreToCloud");
    select(1, "target");
    input("加密归档的绝对路径", "/backups/workspace.age");
    input("本地 age 私钥文件路径", "/private/recovery-key");
    input("可信 SHA-256 校验值", "0".repeat(64));
    input("新目录名称（字母、数字、短横线或下划线）", "first");
    const button = container.querySelector("button")!;
    const consent = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(button.disabled).toBe(true);
    act(() => consent.click());
    expect(button.disabled).toBe(false);
    input("新目录名称（字母、数字、短横线或下划线）", "recovered");
    expect(button.disabled).toBe(true);
    expect(consent.checked).toBe(false);
    act(() => button.click());
    expect(invoke).not.toHaveBeenCalled();
    act(() => consent.click());
    await act(async () => button.click());
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      action: "restoreArchiveToCloud",
      resource,
      archivePath: "/backups/workspace.age",
      identityFile: "/private/recovery-key",
      expectedSha256: "0".repeat(64),
      folderName: "recovered",
      confirmed: true,
    });
    expect(container.textContent).toContain(destination);
    expect(request).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
