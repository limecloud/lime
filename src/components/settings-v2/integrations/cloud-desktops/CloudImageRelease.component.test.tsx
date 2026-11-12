import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudResourceActions } from "./CloudResourceActions";

const resource = {
  provider: "ecs" as const,
  profile: "owned",
  regionId: "cn-test",
  resourceId: "i-test",
};
const image = {
  action: "createEcsImage",
  outcome: "imageReady",
  operationId: "image-1",
  resource,
};
const request = vi.fn();
let root: Root;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
function render(operations = [image]) {
  act(() =>
    root.render(
      <CloudResourceActions
        resource={resource}
        operations={operations}
        status="Stopped"
        canRelease
        disabled={false}
        request={request}
        onChanged={vi.fn()}
      />,
    ),
  );
}
function button(label: string) {
  const value = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(value, label).toBeTruthy();
  return value!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
async function check(label: string) {
  const input = [...document.querySelectorAll("label")]
    .find((item) => item.textContent?.trim() === label)
    ?.querySelector("input");
  expect(input, label).toBeTruthy();
  act(() => input!.click());
  await settle();
}
async function confirmResource() {
  const input = document.querySelector<HTMLInputElement>(
    `input[placeholder="${resource.resourceId}"]`,
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, resource.resourceId);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  await check("我已保存工作，并停止正在写入文件的任务。");
  await check("我确认永久删除此电脑上的全部磁盘数据。");
}
async function select(value: string) {
  const input = document.querySelector("select")!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("electronAPI", undefined);
  await changeLimeLocale("zh-CN");
  request.mockReset().mockImplementation(async (params) => ({
    data: {
      operationId: params.operationId,
      outcome: "accepted",
      releaseImage: { imageId: "m-test", snapshotId: "s-test" },
    },
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("retains an exact private-image operation without requiring an already restored second desktop", async () => {
  render();
  await click("释放电脑");
  expect(document.querySelector("select")?.value).toBe("image-1");
  expect(document.body.textContent).toContain("镜像和快照仍可能收费");
  await confirmResource();
  expect(button("保留镜像并释放").disabled).toBe(true);
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  expect(button("保留镜像并释放").disabled).toBe(false);
  await click("保留镜像并释放");
  expect(request).toHaveBeenCalledExactlyOnceWith({
    action: "release",
    resource,
    operationId: expect.any(String),
    confirmation: "release:cn-test:i-test:discard-data:image:image-1",
    workSaved: true,
    discardData: true,
    imageOperationId: "image-1",
  });
  expect(document.body.textContent).toContain("m-test");
  expect(document.body.textContent).toContain("s-test");
  expect(document.body.textContent).not.toContain("文件已恢复到新目录");
});

it("keeps the original operation after verification failure and never silently falls back to unprotected release", async () => {
  request.mockRejectedValueOnce(new Error("Retained image unavailable"));
  render();
  await click("释放电脑");
  await confirmResource();
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  await click("保留镜像并释放");
  const original = request.mock.calls[0][0];
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "unavailable",
  );
  await click("关闭");
  await click("查询操作收据");
  const read = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((item) => item.textContent === "查询操作收据")!;
  act(() => read.click());
  await settle();
  expect(request).toHaveBeenLastCalledWith({
    action: "readOperation",
    operationId: original.operationId,
  });
  expect(
    request.mock.calls.filter(([params]) => params.action === "release"),
  ).toHaveLength(1);
});

it("offers only ready image operations from the same account, region and desktop", async () => {
  render([
    { ...image, outcome: "accepted" },
    { ...image, resource: { ...resource, profile: "other" } },
    { ...image, resource: { ...resource, regionId: "cn-other" } },
    { ...image, resource: { ...resource, resourceId: "i-other" } },
  ]);
  await click("释放电脑");
  expect(document.querySelector("select")).toBeNull();
  await confirmResource();
  await click("确认执行");
  expect(request.mock.calls[0][0]).not.toHaveProperty("imageOperationId");
});

it("changing the retained image clears consent and binds the new exact image in the confirmation", async () => {
  render([image, { ...image, operationId: "image-2" }]);
  await click("释放电脑");
  await confirmResource();
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  await select("image-2");
  expect(button("保留镜像并释放").disabled).toBe(true);
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  await check("我确认永久删除此电脑上的全部磁盘数据。");
  await click("保留镜像并释放");
  expect(request.mock.calls[0][0]).toMatchObject({
    imageOperationId: "image-2",
    confirmation: "release:cn-test:i-test:discard-data:image:image-2",
  });
});

it("switching to the existing release flow removes the image binding and clears discard consent", async () => {
  render();
  await click("释放电脑");
  await confirmResource();
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  await select("");
  expect(button("确认执行").disabled).toBe(true);
  await check("我确认永久删除此电脑上的全部磁盘数据。");
  await click("确认执行");
  expect(request.mock.calls[0][0]).toMatchObject({
    confirmation: "release:cn-test:i-test:discard-data",
  });
  expect(request.mock.calls[0][0]).not.toHaveProperty("imageOperationId");
});

it("a verified not-submitted response clears consent and allows a newly confirmed operation", async () => {
  request.mockImplementationOnce(async (params) => ({
    data: {
      operationId: params.operationId,
      outcome: "notSubmitted",
      submitted: false,
      requiresInspection: false,
    },
  }));
  render();
  await click("释放电脑");
  await confirmResource();
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  await click("保留镜像并释放");
  const original = request.mock.calls[0][0].operationId;
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "未提交释放",
  );
  expect(button("保留镜像并释放").disabled).toBe(true);
  await check("确认保留所选镜像，并丢弃快照之后的全部更改。");
  await check("我确认永久删除此电脑上的全部磁盘数据。");
  await click("保留镜像并释放");
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0].operationId).not.toBe(original);
  expect(request.mock.calls[1][0].imageOperationId).toBe("image-1");
});
