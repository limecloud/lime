import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { CloudDesktopParams } from "@limecloud/app-server-client";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: api.request }));
import { AddCloudDesktop } from "./AddCloudDesktop";
import { CloudResourceActions } from "./CloudResourceActions";
import { CloudDesktopsSettings } from "./CloudDesktopsSettings";
import {
  CloudSnapshotRestore,
  CloudRestoreVerification,
} from "./CloudSnapshotRestore";

const restoreConsent = "确认丢弃所选磁盘在快照之后的全部更改。";
async function restoreForm(status = "Stopped") {
  act(() =>
    root.render(
      <CloudSnapshotRestore
        resource={resource}
        status={status}
        disabled={false}
        request={api.request}
        onChanged={vi.fn()}
      />,
    ),
  );
  await settle();
  await click("从快照恢复");
  await fill("快照编号", "s-test");
}

let root: Root;
let container: HTMLDivElement;
const resource = {
  provider: "wuying" as const,
  profile: "test",
  regionId: "cn-test",
  resourceId: "ecd-test",
};

async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    // Radix FocusScope restores focus in a timer after the dialog unmounts.
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}
function button(label: string) {
  const value = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(value, `missing button: ${label}`).toBeTruthy();
  return value!;
}
async function click(label: string) {
  act(() => button(label).click());
  await settle();
}
async function fill(label: string, value: string) {
  const element = [...document.querySelectorAll("label")]
    .find(
      (item) =>
        item.querySelector("span")?.textContent === label &&
        item.querySelector("input"),
    )
    ?.querySelector("input");
  expect(element, `missing field: ${label}`).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
async function check(label: string) {
  const element = [...document.querySelectorAll("label")]
    .find((item) => item.textContent?.trim() === label)
    ?.querySelector("input");
  expect(element).toBeTruthy();
  act(() => element!.click());
  await settle();
}
async function purchaseForm(provider = "wuying") {
  act(() => root.render(<AddCloudDesktop onChanged={vi.fn()} />));
  await settle();
  await click("添加电脑");
  const tab = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((item) => item.textContent === "购买 Linux 电脑")!;
  act(() =>
    tab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
  await settle();
  const select = document.querySelector<HTMLSelectElement>(
    '[role="tabpanel"] select',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(select, provider);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  if (provider === "ecs") {
    const summary = [...document.querySelectorAll("summary")].find(
      (item) => item.textContent?.trim() === "高级设置",
    );
    act(() => summary!.click());
    await settle();
  }
  const fields =
    provider === "wuying"
      ? [
          ["办公网络 ID", "cn-test+dir-test"],
          ["无影用户 ID", "tester"],
          ["无影策略 ID", "policy-test"],
        ]
      : [
          ["交换机 ID", "vsw-test"],
          ["安全组 ID", "sg-test"],
          ["SSH 密钥对名称（可选）", "key-test"],
          ["实例规格", "ecs.test.large"],
          ["Linux 镜像 ID", "ubuntu-test"],
        ];
  for (const [label, value] of [
    ["本机阿里云 CLI 配置名称", "test"],
    ["区域 ID", "cn-test"],
    ["电脑名称", "test-desktop"],
    ...fields,
  ])
    await fill(label, value);
  await click("获取实时报价");
  await check("确认按此规格和报价购买一台电脑，由我的阿里云账户支付。");
}
beforeEach(async () => {
  vi.stubGlobal("electronAPI", {
    invoke: vi.fn(
      async (command: string, args: { request: { action: string } }) => {
        if (
          command === "cloud_desktop_connection" &&
          args.request.action === "checkRuntimeRelease"
        )
          return { kind: "guestRelease", available: true, version: "test" };
        if (
          command === "cloud_desktop_connection" &&
          args.request.action === "readReleaseBackup"
        )
          return { kind: "releaseBackup" };
        throw new Error("Unexpected host request");
      },
    ),
    supportsCommand: () => true,
  });
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  api.request.mockImplementation(async (params: CloudDesktopParams) => ({
    data:
      params.action === "quoteWuying" || params.action === "quoteEcs"
        ? {
            quoteId: "quote-test",
            quote: {
              price: { currency: "CNY", hourlyPrice: 0.75 },
              expiresAt: new Date(Date.now() + 900000).toISOString(),
            },
          }
        : { outcome: "unknown" },
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Cloud desktop operation recovery", () => {
  it("requires only package consent to prepare a running ECS and recovers the original operation", async () => {
    const ecs = { ...resource, provider: "ecs" as const, resourceId: "i-test" };
    let finish: (value: unknown) => void = () => undefined;
    api.request.mockImplementation((params: CloudDesktopParams) => {
      if (params.action === "prepareEcsDesktop")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve({
        data: {
          outcome: "dependenciesReady",
          packagesPrepared: true,
          desktopReady: false,
          runtimeInstalled: false,
        },
      });
    });
    act(() =>
      root.render(
        <CloudResourceActions
          resource={ecs}
          status="Running"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    await click("准备 Linux 桌面");
    expect(button("确认执行").disabled).toBe(true);
    expect(document.querySelector('input[type="text"]')).toBeNull();
    await check("我同意在此电脑上以管理员身份安装系统桌面软件包。");
    act(() => {
      button("确认执行").click();
      button("确认执行").click();
    });
    await settle();
    expect(api.request).toHaveBeenCalledTimes(1);
    const original = api.request.mock.calls[0][0];
    expect(original).toMatchObject({
      action: "prepareEcsDesktop",
      resource: ecs,
      confirmation: "prepareEcsDesktop:cn-test:i-test",
      installSystemPackages: true,
    });
    await act(async () =>
      finish({
        data: {
          operationId: original.operationId,
          outcome: "accepted",
          requiresInspection: true,
          desktopReady: false,
        },
      }),
    );
    await settle();
    await click("关闭");
    await click("查询操作收据");
    const readReceipt = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((item) => item.textContent?.trim() === "查询操作收据");
    expect(readReceipt).toBeTruthy();
    act(() => readReceipt!.click());
    await settle();
    expect(api.request.mock.calls[1][0]).toEqual({
      action: "readOperation",
      operationId: original.operationId,
    });
    expect(document.body.textContent).toContain(
      "桌面依赖已准备。Lime 运行包与连接尚需配置。",
    );
    expect(
      api.request.mock.calls.filter(([p]) => p.action === "prepareEcsDesktop"),
    ).toHaveLength(1);
  });

  it("does not offer ECS preparation for Wuying or a stopped instance", async () => {
    act(() =>
      root.render(
        <CloudResourceActions
          resource={resource}
          status="Running"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    expect(document.body.textContent).not.toContain("准备 Linux 桌面");
    act(() =>
      root.render(
        <CloudResourceActions
          resource={{ ...resource, provider: "ecs", resourceId: "i-test" }}
          status="Stopped"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    expect(document.body.textContent).not.toContain("准备 Linux 桌面");
    expect(api.request).not.toHaveBeenCalled();
  });

  it("allows an explicit new preparation only after a confirmed non-submission", async () => {
    const ecs = { ...resource, provider: "ecs" as const, resourceId: "i-test" };
    api.request.mockImplementation(async (params: CloudDesktopParams) => ({
      data: {
        outcome: "notSubmitted",
        submitted: false,
        request: params,
      },
    }));
    act(() =>
      root.render(
        <CloudResourceActions
          resource={ecs}
          status="Running"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    await click("准备 Linux 桌面");
    await check("我同意在此电脑上以管理员身份安装系统桌面软件包。");
    await click("确认执行");
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("安装请求尚未发送");
    expect(button("确认执行").disabled).toBe(false);
    await click("确认执行");
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.request.mock.calls[1][0].operationId).not.toBe(
      api.request.mock.calls[0][0].operationId,
    );
  });
  it.each(["PostPaid", "PrePaid", undefined])(
    "uses the provider billing state to gate ECS release: %s",
    async (instanceChargeType) => {
      const target = {
        ...resource,
        provider: "ecs" as const,
        resourceId: "i-test",
      };
      api.request.mockImplementation(async (params: CloudDesktopParams) => ({
        data:
          params.action === "listResources"
            ? { resources: [target], operations: [] }
            : { status: "Stopped", instanceChargeType },
      }));
      act(() => root.render(<CloudDesktopsSettings />));
      await settle();
      expect(
        [...container.querySelectorAll("button")].some(
          (item) => item.textContent === "释放电脑",
        ),
      ).toBe(instanceChargeType === "PostPaid");
      expect(api.request).toHaveBeenCalledWith({
        action: "inspect",
        resource: target,
      });
    },
  );

  it("only offers release for a stopped PostPaid cloud desktop", async () => {
    for (const [target, status, canRelease, visible] of [
      [resource, "Running", true, false],
      [resource, "Stopped", false, false],
      [
        { ...resource, provider: "ecs" as const, resourceId: "i-test" },
        "Running",
        true,
        false,
      ],
      [
        { ...resource, provider: "ecs" as const, resourceId: "i-test" },
        "Stopped",
        false,
        false,
      ],
      [
        { ...resource, provider: "ecs" as const, resourceId: "i-test" },
        "Stopped",
        true,
        true,
      ],
      [resource, "Stopped", true, true],
    ] as const) {
      act(() =>
        root.render(
          <CloudResourceActions
            resource={target}
            status={status}
            canRelease={canRelease}
            disabled={false}
            request={api.request}
            onChanged={vi.fn()}
          />,
        ),
      );
      await settle();
      expect(
        [...container.querySelectorAll("button")].some(
          (item) => item.textContent === "释放电脑",
        ),
      ).toBe(visible);
    }
    expect(api.request).not.toHaveBeenCalled();
  });

  it.each([
    resource,
    { ...resource, provider: "ecs" as const, resourceId: "i-test" },
  ])(
    "requires disk discard consent and resumes the original release for $provider",
    async (target) => {
      api.request.mockRejectedValueOnce(new Error("response lost"));
      act(() =>
        root.render(
          <CloudResourceActions
            resource={target}
            status="Stopped"
            canRelease
            disabled={false}
            request={api.request}
            onChanged={vi.fn()}
          />,
        ),
      );
      await settle();
      await click("释放电脑");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        target.provider === "ecs"
          ? "保留的数据盘、快照和网络资源仍可能收费"
          : "永久删除电脑及随附磁盘",
      );
      await fill("输入电脑 ID 确认", "ecd-other");
      await check("我已保存工作，并停止正在写入文件的任务。");
      await check("我确认永久删除此电脑上的全部磁盘数据。");
      expect(button("确认执行").disabled).toBe(true);
      await fill("输入电脑 ID 确认", target.resourceId);
      await check("我确认永久删除此电脑上的全部磁盘数据。");
      expect(button("确认执行").disabled).toBe(true);
      await check("我确认永久删除此电脑上的全部磁盘数据。");
      await check("我已保存工作，并停止正在写入文件的任务。");
      expect(button("确认执行").disabled).toBe(true);
      await check("我已保存工作，并停止正在写入文件的任务。");
      const confirm = button("确认执行");
      expect(confirm.disabled).toBe(false);
      act(() => {
        confirm.click();
        confirm.click();
      });
      await settle();
      const original = api.request.mock.calls[0][0];
      expect(original).toMatchObject({
        action: "release",
        resource: target,
        workSaved: true,
        discardData: true,
        confirmation: `release:cn-test:${target.resourceId}:discard-data`,
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "response lost",
      );
      await click("关闭");
      await click("查询操作收据");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        original.operationId,
      );
      const read = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ].find((item) => item.textContent === "查询操作收据")!;
      act(() => read.click());
      await settle();
      expect(api.request).toHaveBeenLastCalledWith({
        action: "readOperation",
        operationId: original.operationId,
      });
      expect(
        api.request.mock.calls.filter(
          ([params]) => params.action === "release",
        ),
      ).toHaveLength(1);
    },
  );

  it("requires application readback for a verified backup and does not fall back on preflight failure", async () => {
    const restoredTo = { ...resource, resourceId: "ecd-new" };
    const sha256 = "c".repeat(64);
    const invoke = vi.fn(
      async (_command: string, args: { request: { action: string } }) =>
        args.request.action === "readReleaseBackup"
          ? {
              kind: "releaseBackup",
              backup: { sha256, savedAt: new Date().toISOString(), restoredTo },
            }
          : {
              kind: "releaseWithBackup",
              data: { outcome: "notSubmitted", submitted: false },
            },
    );
    vi.stubGlobal("electronAPI", { invoke });
    try {
      act(() =>
        root.render(
          <CloudResourceActions
            resource={resource}
            status="Stopped"
            canRelease
            disabled={false}
            request={api.request}
            onChanged={vi.fn()}
          />,
        ),
      );
      await click("释放电脑");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "ecd-new",
      );
      await fill("输入电脑 ID 确认", resource.resourceId);
      await check("我已保存工作，并停止正在写入文件的任务。");
      await check("我确认永久删除此电脑上的全部磁盘数据。");
      expect(button("验证备份并释放").disabled).toBe(true);
      await check(
        "我已在新电脑的应用里打开恢复的文件，并确认没有需要保留的后续改动。",
      );
      await click("验证备份并释放");
      expect(
        invoke.mock.calls.filter(
          ([, args]) => args.request.action === "releaseWithBackup",
        ),
      ).toEqual([
        [
          "cloud_desktop_connection",
          {
            request: expect.objectContaining({
              action: "releaseWithBackup",
              resource,
              restoredTo,
              archiveSha256: sha256,
              workSaved: true,
              discardData: true,
              applicationsValidated: true,
            }),
          },
        ],
      ]);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "未提交释放",
      );
      expect(button("验证备份并释放").disabled).toBe(true);
      expect(api.request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retains a pending release through failed queries and removes it only after verified absence", async () => {
    vi.useFakeTimers();
    let outcome = "accepted";
    let failRead = true;
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "listResources")
        return {
          data: {
            resources: [resource],
            operations: [
              {
                operationId: "release-persisted",
                action: "release",
                outcome: "accepted",
                resource,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        };
      if (params.action === "readOperation") {
        if (failRead) throw new Error("verification unavailable");
        return { data: { outcome } };
      }
      return {
        data: {
          name: "我的云电脑",
          status: "Stopped",
          instanceChargeType: "PostPaid",
        },
      };
    });
    act(() => root.render(<CloudDesktopsSettings />));
    await settle();
    expect(document.body.textContent).toContain("我的云电脑");
    expect(button("启动").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "verification unavailable",
    );
    expect(document.body.textContent).not.toContain("已释放");
    failRead = false;
    act(() => vi.advanceTimersByTime(5000));
    await settle();
    expect(document.body.textContent).toContain("我的云电脑");
    outcome = "released";
    act(() => vi.advanceTimersByTime(5000));
    await settle();
    expect(document.body.textContent).not.toContain("我的云电脑");
    expect(document.body.textContent).toContain("已释放");
    expect(
      api.request.mock.calls.filter(([params]) => params.action === "release"),
    ).toHaveLength(0);
    expect(
      api.request.mock.calls
        .filter(([params]) => params.action === "readOperation")
        .every(([params]) => params.operationId === "release-persisted"),
    ).toBe(true);
  });

  it("keeps a closed dialog out of the accessibility tree and restores focus", async () => {
    act(() => root.render(<AddCloudDesktop onChanged={vi.fn()} />));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe("none");
    await click("添加电脑");
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await click("关闭");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button("添加电脑"));
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("submits a purchase once and preserves unknown results after close and reopen", async () => {
    await purchaseForm();
    api.request.mockImplementation(async () => {
      throw new Error("connection lost");
    });
    const buy = button("确认购买");
    act(() => {
      buy.click();
      buy.click();
    });
    await settle();
    const purchases = api.request.mock.calls.filter(
      ([params]) => params.action === "purchaseWuying",
    );
    expect(purchases).toHaveLength(1);
    const id = purchases[0][0].operationId;
    expect(document.body.textContent).toContain(id);
    await click("关闭");
    await click("添加电脑");
    expect(document.body.textContent).toContain(id);
    expect(
      [...document.querySelectorAll("button")].some(
        (item) => item.textContent === "确认购买",
      ),
    ).toBe(false);
    api.request.mockResolvedValue({
      data: { outcome: "unknown", operationId: id },
    });
    await click("查询操作收据");
    expect(api.request).toHaveBeenLastCalledWith({
      action: "readOperation",
      operationId: id,
    });
    expect(
      api.request.mock.calls.filter(
        ([params]) => params.action === "purchaseWuying",
      ),
    ).toHaveLength(1);
  });

  it("defaults to ECS and locks provider changes while retaining a lost purchase", async () => {
    await purchaseForm("ecs");
    expect(document.body.textContent).toContain("系统盘固定请求加密");
    api.request.mockRejectedValue(new Error("connection lost"));
    const buy = button("确认购买");
    act(() => {
      buy.click();
      buy.click();
    });
    await settle();
    const purchases = api.request.mock.calls.filter(
      ([params]) => params.action === "purchaseEcs",
    );
    expect(purchases).toHaveLength(1);
    const submitted = purchases[0][0];
    expect(submitted.spec).toMatchObject({
      vSwitchId: "vsw-test",
      securityGroupId: "sg-test",
      keyPairName: "key-test",
      systemDiskGib: 80,
    });
    expect(submitted.confirmation).toBe(
      `purchase:ecs:cn-test:test-desktop:${submitted.quoteId}`,
    );
    expect(
      document.querySelector<HTMLSelectElement>('[role="tabpanel"] select')!
        .disabled,
    ).toBe(true);
    await click("关闭");
    await click("添加电脑");
    expect(document.body.textContent).toContain(submitted.operationId);
    api.request.mockResolvedValue({
      data: {
        outcome: "provisioned",
        instanceId: "i-test",
        operationId: submitted.operationId,
        desktopReady: false,
      },
    });
    await click("查询操作收据");
    expect(document.body.textContent).toContain("请继续安装 Linux 桌面和 Lime");
    expect(document.body.textContent).toContain("i-test");
    expect(
      api.request.mock.calls.filter(
        ([params]) => params.action === "purchaseEcs",
      ),
    ).toHaveLength(1);
  });

  it("allows a new quote only after an explicit server non-submission", async () => {
    await purchaseForm("ecs");
    api.request.mockImplementation(async (params: CloudDesktopParams) => ({
      data: {
        operationId: "operationId" in params ? params.operationId : undefined,
        outcome: "notSubmitted",
        submitted: false,
        requiresInspection: false,
        diagnostic: "Price changed",
      },
    }));
    await click("确认购买");
    expect(document.body.textContent).toContain("尚未下单");
    expect(button("获取实时报价").disabled).toBe(false);
    expect(button("确认购买").disabled).toBe(true);
    expect(
      document.querySelector<HTMLSelectElement>('[role="tabpanel"] select')!
        .disabled,
    ).toBe(false);
    expect(
      api.request.mock.calls.filter(
        ([params]) => params.action === "purchaseEcs",
      ),
    ).toHaveLength(1);
  });

  it("refreshes the computer list after recovering a purchase from durable history", async () => {
    let recovered = false;
    const ecs = {
      provider: "ecs",
      profile: "test",
      regionId: "cn-test",
      resourceId: "i-recovered",
    };
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "listResources")
        return {
          data: {
            resources: recovered ? [ecs] : [],
            operations: [
              {
                action: "purchaseEcs",
                operationId: "recovered-purchase",
                outcome: recovered ? "provisioned" : "unknown",
              },
            ],
          },
        };
      if (params.action === "readOperation") {
        recovered = true;
        return { data: { outcome: "provisioned", instanceId: ecs.resourceId } };
      }
      if (params.action === "inspect")
        return {
          data: {
            resource: ecs,
            name: "Recovered-desktop",
            status: "Stopped",
            instanceChargeType: "PostPaid",
          },
        };
      throw new Error("Unexpected request");
    });
    act(() => root.render(<CloudDesktopsSettings />));
    await settle();
    await click("查询操作收据");
    expect(document.body.textContent).toContain("Recovered-desktop");
    expect(
      api.request.mock.calls.filter(
        ([params]) => params.action === "listResources",
      ).length,
    ).toBeGreaterThan(1);
    expect(
      api.request.mock.calls.some(
        ([params]) => params.action === "purchaseEcs",
      ),
    ).toBe(false);
  });

  it("rejects malformed quote expiry before purchase", async () => {
    api.request.mockResolvedValue({
      data: { quoteId: "quote-test", quote: { expiresAt: "invalid" } },
    });
    await purchaseForm();
    expect(button("确认购买").disabled).toBe(true);
    expect(
      api.request.mock.calls.some(
        ([params]) => params.action === "purchaseWuying",
      ),
    ).toBe(false);
  });

  it("expires an open quote without requiring another user interaction", async () => {
    vi.useFakeTimers();
    await purchaseForm();
    expect(button("确认购买").disabled).toBe(false);
    act(() => vi.advanceTimersByTime(900001));
    await settle();
    expect(button("确认购买").disabled).toBe(true);
    expect(document.body.textContent).toContain("报价已失效");
  });

  it("keeps resource errors distinct from an empty computer list", async () => {
    api.request.mockRejectedValue(new Error("service unavailable"));
    act(() => root.render(<CloudDesktopsSettings />));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "service unavailable",
    );
    expect(document.body.textContent).not.toContain("还没有云电脑");
  });

  it("continues observing an accepted stop while the provider still reports running", async () => {
    vi.useFakeTimers();
    let inspections = 0;
    api.request.mockImplementation(async (params: CloudDesktopParams) => ({
      data:
        params.action === "listResources"
          ? {
              resources: [resource],
              operations: [
                {
                  operationId: "stop-persisted",
                  action: "stop",
                  outcome: "accepted",
                  resource,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : {
              name: "My Linux desktop",
              status: ++inspections > 1 ? "Stopped" : "Running",
            },
    }));
    act(() => root.render(<CloudDesktopsSettings />));
    await settle();
    expect(button("停机保留磁盘").disabled).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    await settle();
    expect(inspections).toBe(2);
    expect(button("启动").disabled).toBe(false);
  });

  it("restores focus to the resource action after dismissing confirmation", async () => {
    act(() =>
      root.render(
        <CloudResourceActions
          resource={resource}
          status="Running"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    const stop = button("停机保留磁盘");
    await click("停机保留磁盘");
    await click("关闭");
    expect(document.activeElement).toBe(stop);
    expect(api.request).not.toHaveBeenCalled();
  });

  it("requires the exact resource and saved work, and resumes the same stop receipt", async () => {
    act(() =>
      root.render(
        <CloudResourceActions
          resource={resource}
          status="Running"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    await click("停机保留磁盘");
    expect(button("确认执行").disabled).toBe(true);
    await fill("输入电脑 ID 确认", "ecd-other");
    await check("我已保存工作，并停止正在写入文件的任务。");
    expect(button("确认执行").disabled).toBe(true);
    await fill("输入电脑 ID 确认", "ecd-test");
    const confirm = button("确认执行");
    act(() => {
      confirm.click();
      confirm.click();
    });
    await settle();
    const stops = api.request.mock.calls.filter(
      ([params]) => params.action === "stop",
    );
    expect(stops).toHaveLength(1);
    expect(stops[0][0]).toMatchObject({
      resource,
      workSaved: true,
      confirmation: "stop:cn-test:ecd-test",
    });
    await click("关闭");
    await click("查询操作收据");
    expect(document.body.textContent).toContain(stops[0][0].operationId);
    const read = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((item) => item.textContent === "查询操作收据")!;
    act(() => read.click());
    await settle();
    expect(api.request).toHaveBeenLastCalledWith({
      action: "readOperation",
      operationId: stops[0][0].operationId,
    });
    expect(
      api.request.mock.calls.filter(([params]) => params.action === "stop"),
    ).toHaveLength(1);
  });
});

describe("snapshot recovery", () => {
  it("keeps an accepted snapshot unresolved until provider inspection reports readiness", async () => {
    api.request.mockImplementation(async (params: CloudDesktopParams) => ({
      data:
        params.action === "readOperation"
          ? { outcome: "snapshotReady", snapshotId: "s-test" }
          : { outcome: "accepted", snapshotId: "s-test" },
    }));
    act(() =>
      root.render(
        <CloudResourceActions
          resource={resource}
          status="Stopped"
          disabled={false}
          request={api.request}
          onChanged={vi.fn()}
        />,
      ),
    );
    await settle();
    await click("创建磁盘快照");
    expect(document.body.textContent).toContain("包括登录资料、密钥和应用数据");
    await fill("输入电脑 ID 确认", "ecd-test");
    await check("我已保存工作，并停止正在写入文件的任务。");
    await click("确认执行");
    await click("关闭");
    expect(document.body.textContent).not.toContain("创建磁盘快照");
    await click("查询操作收据");
    const read = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((item) => item.textContent === "查询操作收据")!;
    act(() => read.click());
    await settle();
    await click("关闭");
    expect(button("创建磁盘快照").disabled).toBe(false);
    expect(
      api.request.mock.calls.filter(([params]) => params.action === "snapshot"),
    ).toHaveLength(1);
  });

  it("requires a current available snapshot, exact resource and both loss confirmations", async () => {
    api.request.mockResolvedValue({
      data: { ready: true, createdAt: "2026-11-10T01:00:00Z" },
    });
    await restoreForm();
    await fill("输入电脑 ID 确认", "ecd-test");
    await check("我已保存工作，并停止正在写入文件的任务。");
    await check(restoreConsent);
    expect(button("确认执行").disabled).toBe(true);
    await click("查询快照");
    expect(api.request).toHaveBeenLastCalledWith({
      action: "inspectSnapshot",
      resource,
      diskId: "system",
      snapshotId: "s-test",
    });
    expect(button("确认执行").disabled).toBe(false);
    expect(document.querySelector("time")?.dateTime).toBe(
      "2026-11-10T01:00:00Z",
    );
    await fill("快照编号", "s-other");
    expect(button("确认执行").disabled).toBe(true);
    expect(document.body.textContent).not.toContain("快照可用于原盘恢复");
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(false);
    expect(
      api.request.mock.calls.filter(
        ([params]) => params.action === "restoreSnapshot",
      ),
    ).toHaveLength(0);
  });

  it.each([
    [true, "已启用"],
    [false, "未启用，请使用加密归档保护敏感资料。"],
    [undefined, "状态未知，请在云控制台核对。"],
    ["true", "状态未知，请在云控制台核对。"],
  ])(
    "shows the provider encryption state %s without inferring it from readiness",
    async (encrypted, label) => {
      api.request.mockResolvedValue({ data: { ready: true, encrypted } });
      await restoreForm();
      await click("查询快照");
      expect(document.body.textContent).toContain(`云端静态加密: ${label}`);
      expect(document.body.textContent).toContain("快照可用于原盘恢复");
      expect(button("确认执行").disabled).toBe(true);
      await fill("快照编号", "s-other");
      expect(document.body.textContent).not.toContain("云端静态加密:");
    },
  );

  it("cannot restore a running computer even when snapshot and consents are ready", async () => {
    api.request.mockResolvedValue({ data: { ready: true } });
    await restoreForm("Running");
    await click("查询快照");
    await fill("输入电脑 ID 确认", "ecd-test");
    await check("我已保存工作，并停止正在写入文件的任务。");
    await check(restoreConsent);
    expect(button("确认执行").disabled).toBe(true);
    expect(document.body.textContent).toContain("请先关闭电脑");
  });

  it("keeps the original operation after a lost response, double click and dialog reopening", async () => {
    api.request.mockImplementation(async (params: CloudDesktopParams) => {
      if (params.action === "inspectSnapshot") return { data: { ready: true } };
      if (params.action === "restoreSnapshot")
        throw new Error("connection lost");
      return { data: { operationId: "original", outcome: "unknown" } };
    });
    await restoreForm();
    await click("查询快照");
    await fill("输入电脑 ID 确认", "ecd-test");
    await check("我已保存工作，并停止正在写入文件的任务。");
    await check(restoreConsent);
    const confirm = button("确认执行");
    act(() => {
      confirm.click();
      confirm.click();
    });
    await settle();
    const restores = api.request.mock.calls.filter(
      ([params]) => params.action === "restoreSnapshot",
    );
    expect(restores).toHaveLength(1);
    expect(restores[0][0]).toMatchObject({
      diskId: "system",
      snapshotId: "s-test",
      workSaved: true,
      discardChanges: true,
      confirmation: "restoreSnapshot:cn-test:ecd-test:system:s-test",
    });
    await click("关闭");
    await click("从快照恢复");
    await click("查询操作收据");
    expect(api.request).toHaveBeenLastCalledWith({
      action: "readOperation",
      operationId: restores[0][0].operationId,
    });
    expect(
      api.request.mock.calls.filter(
        ([params]) => params.action === "restoreSnapshot",
      ),
    ).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "结果待核实",
    );
  });

  it("records user validation through the original receipt without repeating restoration", async () => {
    const onVerified = vi.fn();
    api.request.mockResolvedValue({
      data: { outcome: "verified", verification: "userConfirmed" },
    });
    act(() =>
      root.render(
        <CloudRestoreVerification
          receipt={{
            operationId: "restore-test",
            outcome: "accepted",
            request: {
              action: "restoreSnapshot",
              resource,
              diskId: "system",
              snapshotId: "s-test",
            },
          }}
          request={api.request}
          onChanged={vi.fn()}
          onVerified={onVerified}
        />,
      ),
    );
    await settle();
    expect(button("记录恢复验证").disabled).toBe(true);
    expect(api.request).not.toHaveBeenCalled();
    await check("我已进入恢复后的桌面，验证文件、应用及所需登录状态。");
    await click("记录恢复验证");
    expect(api.request).toHaveBeenCalledExactlyOnceWith({
      action: "verifySnapshotRestore",
      operationId: "restore-test",
      confirmation: "verifyRestore:cn-test:ecd-test:system:s-test",
      applicationsValidated: true,
    });
    expect(onVerified).toHaveBeenCalledWith({
      outcome: "verified",
      verification: "userConfirmed",
    });
  });
});
