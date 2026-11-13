import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CloudSystemImage } from "./CloudSystemImage";
import { EcsSystemImages, type EcsSystemImage } from "./EcsSystemImages";
import { initialEcsSpec } from "./purchaseSpecs";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));

const snapshot = {
  operationId: "cold-snapshot",
  action: "snapshot",
  outcome: "snapshotReady",
  resource: {
    provider: "ecs",
    resourceId: "i-test",
    regionId: "cn-test",
    profile: "owned",
  },
};
const spec = {
  ...initialEcsSpec,
  regionId: "cn-test",
  profile: "owned",
  vSwitchId: "vsw-test",
  securityGroupId: "sg-test",
  keyPairName: "key-test",
  instanceType: "ecs.test.large",
  imageId: "ubuntu-test",
};
const image = {
  imageId: "m-test",
  name: "Saved desktop",
  systemDiskGiB: 100,
  ready: true,
  encrypted: true,
  private: true,
};
let root: Root;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function button(label: string) {
  const result = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === label);
  expect(result, label).toBeTruthy();
  return result!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
async function select(value: string) {
  const field = container.querySelector("select")!;
  act(() => {
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
function Harness() {
  const [context, setContext] = useState(spec);
  const [selected, setSelected] = useState<EcsSystemImage>();
  const [disabled, setDisabled] = useState(false);
  return (
    <>
      <EcsSystemImages
        profile={context.profile}
        regionId={context.regionId}
        disabled={disabled}
        onSelected={setSelected}
      />
      <button
        onClick={() =>
          setContext({ ...spec, profile: "other", regionId: "cn-other" })
        }
      >
        switch
      </button>
      <button onClick={() => setDisabled((value) => !value)}>lock</button>
      <output>
        {JSON.stringify({
          selected,
        })}
      </output>
    </>
  );
}

beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  api.request.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("private system image creation", () => {
  it("requires an eligible cold snapshot and full-disk consent, then submits once and reads the same operation", async () => {
    let resolve!: (value: unknown) => void;
    api.request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() =>
      root.render(
        <CloudSystemImage
          operations={[snapshot]}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    expect(button("保存私有系统镜像").disabled).toBe(true);
    await select("cold-snapshot");
    expect(button("保存私有系统镜像").disabled).toBe(true);
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    act(() => {
      button("保存私有系统镜像").click();
      button("保存私有系统镜像").click();
    });
    await settle();
    expect(api.request).toHaveBeenCalledTimes(1);
    const request = api.request.mock.calls[0][0];
    expect(request).toEqual({
      action: "createEcsImage",
      snapshotOperationId: "cold-snapshot",
      operationId: expect.any(String),
      confirmation: "createEcsImage:cold-snapshot",
      includeCredentials: true,
    });
    await act(async () =>
      resolve({
        data: {
          outcome: "accepted",
          operationId: request.operationId,
          imageId: "m-test",
          request,
          requiresApplicationValidation: true,
        },
      }),
    );
    api.request.mockResolvedValue({
      data: {
        outcome: "imageReady",
        imageId: "m-test",
        request,
        requiresApplicationValidation: true,
      },
    });
    await click("查询操作收据");
    expect(api.request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: request.operationId,
    });
    expect(container.textContent).toContain("m-test");
    expect(container.textContent).toContain("私有系统镜像已可用");
    expect(container.textContent).not.toContain("文件已恢复到新目录");
    expect(container.querySelector<HTMLSelectElement>("select")!.disabled).toBe(
      true,
    );
  });

  it("changing the snapshot clears consent and unavailable or non-ECS snapshots cannot be submitted", async () => {
    act(() =>
      root.render(
        <CloudSystemImage
          operations={[
            snapshot,
            { ...snapshot, operationId: "other-snapshot" },
            { ...snapshot, operationId: "pending", outcome: "accepted" },
            {
              ...snapshot,
              operationId: "wuying",
              resource: { ...snapshot.resource, provider: "wuying" },
            },
          ]}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    expect(container.querySelectorAll("option")).toHaveLength(3);
    await select("cold-snapshot");
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await select("other-snapshot");
    expect(button("保存私有系统镜像").disabled).toBe(true);
    expect(api.request).not.toHaveBeenCalled();
  });

  it("an unknown transport result retains the operation ID and offers only inspection", async () => {
    api.request.mockRejectedValue(new Error("connection lost"));
    act(() =>
      root.render(
        <CloudSystemImage
          operations={[snapshot]}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await select("cold-snapshot");
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await click("保存私有系统镜像");
    const id = api.request.mock.calls[0][0].operationId;
    expect(container.textContent).toContain(id);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "connection lost",
    );
    await click("查询操作收据");
    expect(api.request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: id,
    });
  });
});

describe("private system image selection", () => {
  it("automatically discovers images and only selects an available image without cloud writes", async () => {
    api.request.mockImplementation(async (request) =>
      request.action === "listEcsImages"
        ? {
            data: {
              profile: "owned",
              regionId: "cn-test",
              images: [image, { ...image, imageId: "m-pending", ready: false }],
            },
          }
        : {
            data: {
              quoteId: "quote-test",
              quote: { expiresAt: new Date(Date.now() + 900000).toISOString() },
            },
          },
    );
    act(() => root.render(<Harness />));
    await settle();
    expect(
      container.querySelector<HTMLOptionElement>('option[value="m-pending"]')!
        .disabled,
    ).toBe(true);
    await select("m-test");
    const state = JSON.parse(container.querySelector("output")!.textContent!);
    expect(state.selected).toEqual({
      imageId: "m-test",
      name: image.name,
      systemDiskGiB: 100,
      ready: true,
    });
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.action === "purchaseEcs",
      ),
    ).toHaveLength(0);
    expect(api.request.mock.calls.map(([request]) => request.action)).toEqual([
      "listEcsImages",
    ]);
  });

  it("discards inventory returned after an account/region switch and can load the new context", async () => {
    let resolve!: (value: unknown) => void;
    api.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => root.render(<Harness />));
    await settle();
    api.request.mockResolvedValue({
      data: { profile: "other", regionId: "cn-other", images: [] },
    });
    await click("switch");
    await act(async () =>
      resolve({
        data: { profile: "owned", regionId: "cn-test", images: [image] },
      }),
    );
    expect(container.querySelector("select")).toBeNull();
    api.request.mockResolvedValue({
      data: { profile: "other", regionId: "cn-other", images: [] },
    });
    await click("读取私有系统镜像");
    expect(api.request.mock.calls.at(-1)![0]).toEqual({
      action: "listEcsImages",
      profile: "other",
      regionId: "cn-other",
    });
    expect(container.textContent).toContain("没有符合条件");
  });

  it("rejects malformed or unencrypted inventory without selecting an image", async () => {
    api.request.mockResolvedValue({
      data: {
        profile: "owned",
        regionId: "cn-test",
        images: [{ ...image, encrypted: false }],
      },
    });
    act(() => root.render(<Harness />));
    await settle();
    await click("读取私有系统镜像");
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(
      JSON.parse(container.querySelector("output")!.textContent!).selected,
    ).toBeUndefined();
    expect(container.querySelector("select")).toBeNull();
  });
});
