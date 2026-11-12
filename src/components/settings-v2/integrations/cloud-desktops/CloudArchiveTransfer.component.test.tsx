import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudArchiveTransfer } from "./CloudArchiveTransfer";

let root: Root;
let container: HTMLDivElement;
const request = vi.fn();
const onBusyChange = vi.fn();
const profile = `lime-oauth-${"a".repeat(32)}`;
const sha256 = "c".repeat(64);
const connection = {
  data: { status: "connected", profile, regionId: "cn-test" },
};
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
function render(upload = true, currentRequest = request) {
  act(() =>
    root.render(
      <CloudArchiveTransfer
        request={currentRequest}
        upload={upload}
        localPath="/backups/archive.age"
        sha256={sha256}
        onBusyChange={onBusyChange}
      />,
    ),
  );
}
function button(text: string) {
  const value = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  expect(value, text).toBeTruthy();
  return value!;
}
function field(label: string) {
  const value = [...container.querySelectorAll("label")]
    .find((item) => item.querySelector("span")?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  expect(value, label).toBeTruthy();
  return value!;
}
async function fill(label: string, value: string) {
  const element = field(label);
  act(() => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLInputElement ? "input" : "change", {
        bubbles: true,
      }),
    );
  });
  await settle();
}
async function click(text: string) {
  act(() => button(text).click());
  await settle();
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  request.mockImplementation(async ({ action }) =>
    action === "readAlibabaConnection"
      ? connection
      : { data: { buckets: ["bucket-test"], regionId: "cn-test" } },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reuses the browser identity and archive metadata, loads buckets explicitly and submits only once", async () => {
  render();
  await settle();
  expect(request).toHaveBeenCalledExactlyOnceWith({
    action: "readAlibabaConnection",
  });
  expect(field("加密归档的绝对路径").value).toBe("/backups/archive.age");
  expect(field("可信 SHA-256 校验值").value).toBe(sha256);
  expect(field("对象名称").value).toMatch(/^lime-backups\/[a-f0-9-]+\.age$/);
  expect(container.textContent).not.toContain("AccessKey");
  await click("读取存储桶");
  expect(request).toHaveBeenLastCalledWith({
    action: "listOssBuckets",
    profile,
    regionId: "cn-test",
  });
  expect(field("存储桶").value).toBe("bucket-test");
  let finish!: (value: unknown) => void;
  request.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const submit = button("上传到 S3 / OSS");
  act(() => {
    submit.click();
    submit.click();
  });
  await settle();
  expect(request).toHaveBeenCalledTimes(3);
  expect(request).toHaveBeenLastCalledWith({
    action: "transferOssArchive",
    profile,
    regionId: "cn-test",
    bucket: "bucket-test",
    objectKey: field("对象名称").value,
    localPath: "/backups/archive.age",
    expectedSha256: sha256,
    upload: true,
  });
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await act(async () =>
    finish({
      data: {
        bucket: "bucket-test",
        objectKey: "saved.age",
        localPath: "/backups/archive.age",
        sha256,
        restoreVerified: false,
      },
    }),
  );
  await settle();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(container.textContent).toContain("saved.age");
  expect(button("上传到 S3 / OSS").disabled).toBe(true);
  await fill("存储桶地域 ID", "cn-other");
  expect(container.textContent).not.toContain("saved.age");
  expect(container.querySelector('option[value="bucket-test"]')).toBeNull();
  expect(button("上传到 S3 / OSS").disabled).toBe(true);
});

it("preserves configured rclone transfers when no browser account is connected", async () => {
  request.mockResolvedValueOnce({ data: { status: "disconnected" } });
  render(false);
  await settle();
  expect(button("读取存储桶").disabled).toBe(true);
  expect(container.textContent).toContain("请先在购买云电脑时连接阿里云账号");
  await fill("存储位置", "rclone");
  await fill("rclone 远程路径", "scoped:backups/archive.age");
  await click("下载到本机");
  expect(request).toHaveBeenLastCalledWith({
    action: "transferArchive",
    remote: "scoped:backups/archive.age",
    localPath: "/backups/archive.age",
    expectedSha256: sha256,
    upload: false,
  });
});

it("shows empty and failure states without projecting provider diagnostics or falling back", async () => {
  render();
  await settle();
  request.mockResolvedValueOnce({ data: { buckets: [], regionId: "cn-test" } });
  await click("读取存储桶");
  expect(container.textContent).toContain("没有可用的存储桶");
  request.mockRejectedValueOnce(new Error("OSS_LIST_FAILED synthetic-secret"));
  await click("读取存储桶");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "无法读取存储桶",
  );
  expect(container.textContent).not.toContain("synthetic-secret");
  expect(button("上传到 S3 / OSS").disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(3);
});

it("drops a pending listing when the request context changes", async () => {
  render();
  await settle();
  let finish!: (value: unknown) => void;
  request.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await click("读取存储桶");
  const next = vi.fn().mockResolvedValue({ data: { status: "disconnected" } });
  render(true, next);
  await settle();
  await act(async () =>
    finish({ data: { buckets: ["stale-bucket"], regionId: "cn-test" } }),
  );
  await settle();
  expect(container.textContent).not.toContain("stale-bucket");
  expect(button("读取存储桶").disabled).toBe(true);
});
