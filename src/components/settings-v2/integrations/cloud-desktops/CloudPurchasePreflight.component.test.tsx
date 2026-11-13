import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudDesktopParams,
  EcsDesktopSpec,
  WuyingDesktopSpec,
} from "@limecloud/app-server-client";
import { changeLimeLocale } from "@/i18n/createI18n";
import { useCloudPurchase } from "./useCloudPurchase";
import { PurchaseActions } from "./PurchaseActions";
import { initialEcsSpec, initialWuyingSpec } from "./purchaseSpecs";
import { purchaseNetworkProof } from "./cloudPurchase.testFixtures";

const spec = {
  ...initialEcsSpec,
  regionId: "cn-test",
  profile: "test",
  vSwitchId: "vsw-test",
  securityGroupId: "sg-test",
  keyPairName: "",
  instanceType: "ecs.test.large",
  imageId: "ubuntu-test",
};
const request = vi.fn();
const purchased = vi.fn();
let state: ReturnType<
  typeof useCloudPurchase<EcsDesktopSpec | WuyingDesktopSpec>
>;
let root: Root;
let container: HTMLDivElement;
let mounted: boolean;

function Harness({
  initialSpec = spec,
}: {
  initialSpec?: EcsDesktopSpec | WuyingDesktopSpec;
}) {
  state = useCloudPurchase({ initialSpec, request, onPurchased: purchased });
  return <PurchaseActions purchase={state} />;
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function calls(action: string) {
  return request.mock.calls
    .map(([p]) => p as CloudDesktopParams)
    .filter((p) => p.action === action);
}
async function approve(initialSpec?: WuyingDesktopSpec) {
  act(() => root.render(<Harness initialSpec={initialSpec} />));
  await settle();
  act(() => {
    state.setName("Lime-test");
    state.setQuote({
      quoteId: "quote-test",
      quote: { expiresAt: new Date(Date.now() + 900_000).toISOString() },
    });
    state.setApproved(true);
  });
  await settle();
}
function deferredCheck() {
  let resolve!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    void state.run("purchase");
    void state.run("purchase");
  });
  return async () => {
    await act(async () =>
      resolve(
        purchaseNetworkProof({
          action: "preflightEcsPurchase",
          spec,
          quoteId: "quote-test",
        }),
      ),
    );
    await settle();
  };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await changeLimeLocale("zh-CN");
  purchased.mockReset();
  request.mockReset().mockImplementation(async (p: CloudDesktopParams) => {
    if (p.action === "preflightEcsPurchase") return purchaseNetworkProof(p);
    if (p.action === "purchaseEcs" || p.action === "purchaseWuying")
      return { data: { operationId: p.operationId, outcome: "unknown" } };
    if (p.action === "readOperation")
      return { data: { operationId: p.operationId, outcome: "unknown" } };
    throw Error(`Unexpected request: ${p.action}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});
afterEach(async () => {
  if (mounted) act(() => root.unmount());
  await settle();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("购买前自动网络检查", () => {
  it("只检查一次，通过之前不生成采购编号；未知结果只读取原操作", async () => {
    await approve();
    const finish = deferredCheck();
    await settle();
    expect(state.checkingNetwork).toBe(true);
    expect(state.submitted).toBe(false);
    expect(container.textContent).toContain("正在检查网络，尚未购买");
    expect(calls("preflightEcsPurchase")).toEqual([
      { action: "preflightEcsPurchase", spec, quoteId: "quote-test" },
    ]);
    expect(calls("purchaseEcs")).toHaveLength(0);
    await finish();
    expect(calls("purchaseEcs")).toHaveLength(1);
    const id = state.operationId;
    await act(async () => {
      await state.run("read");
      await state.run("purchase");
    });
    expect(calls("readOperation")).toEqual([
      { action: "readOperation", operationId: id },
    ]);
    expect(calls("preflightEcsPurchase")).toHaveLength(1);
    expect(calls("purchaseEcs")).toHaveLength(1);
  });

  it("网络失败保留报价和费用同意，可直接重试且不暴露原始错误", async () => {
    await approve();
    request.mockRejectedValueOnce(Error("private network diagnostic"));
    await act(async () => {
      await state.run("purchase");
    });
    expect(state.submitted).toBe(false);
    expect(state.quote?.quoteId).toBe("quote-test");
    expect(state.approved).toBe(true);
    expect(container.textContent).toContain("网络检查未通过，尚未购买");
    expect(container.textContent).not.toContain("private network diagnostic");
    expect(calls("purchaseEcs")).toHaveLength(0);
    await act(async () => {
      await state.run("purchase");
    });
    expect(calls("preflightEcsPurchase")).toHaveLength(2);
    expect(calls("purchaseEcs")).toHaveLength(1);
  });

  it.each([
    "wrong-quote",
    "expired",
    "future",
    "long",
    "not-ready",
    "malformed",
  ])("拒绝无效检查记录 %s", async (kind) => {
    await approve();
    const proof = purchaseNetworkProof({
      action: "preflightEcsPurchase",
      spec,
      quoteId: "quote-test",
    });
    if (kind === "wrong-quote") proof.data.quoteId = "other";
    if (kind === "expired")
      proof.data.expiresAt = new Date(Date.now() - 1).toISOString();
    if (kind === "future")
      proof.data.checkedAt = new Date(Date.now() + 1).toISOString();
    if (kind === "long")
      proof.data.expiresAt = new Date(Date.now() + 61_000).toISOString();
    if (kind === "not-ready") proof.data.networkReady = false;
    request.mockResolvedValueOnce(kind === "malformed" ? { data: {} } : proof);
    await act(async () => {
      await state.run("purchase");
    });
    expect(state.operationId).toBe("");
    expect(calls("purchaseEcs")).toHaveLength(0);
  });

  it.each([
    "profile",
    "region",
    "spec",
    "name",
    "quote",
    "approval",
    "expired",
    "unmounted",
  ])("等待中上下文变化 %s 不能触发迟到购买", async (kind) => {
    await approve();
    const finish = deferredCheck();
    await settle();
    act(() => {
      if (kind === "profile") state.setSpec({ ...spec, profile: "other" });
      if (kind === "region") state.setSpec({ ...spec, regionId: "cn-other" });
      if (kind === "spec") state.setSpec({ ...spec, outboundMbps: 10 });
      if (kind === "name") state.setName("Lime-other");
      if (kind === "quote")
        state.setQuote({ ...state.quote, quoteId: "new-quote" });
      if (kind === "approval") state.setApproved(false);
      if (kind === "expired") vi.advanceTimersByTime(900_001);
      if (kind === "unmounted") {
        root.unmount();
        mounted = false;
      }
    });
    await settle();
    await finish();
    expect(calls("purchaseEcs")).toHaveLength(0);
    expect(purchased).not.toHaveBeenCalled();
  });

  it("服务端明确检查失效后保留报价，自动重新检查再购买", async () => {
    await approve();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (p: CloudDesktopParams) =>
      p.action === "purchaseEcs"
        ? {
            data: {
              operationId: p.operationId,
              outcome: "notSubmitted",
              submitted: false,
              requiresInspection: false,
              diagnostic: "CLOUD_PURCHASE_PREFLIGHT_REQUIRED",
            },
          }
        : normal(p),
    );
    await act(async () => {
      await state.run("purchase");
    });
    expect(state.submitted).toBe(false);
    expect(state.canPurchase).toBe(true);
    expect(container.textContent).toContain("网络检查已失效，尚未购买");
    expect(container.textContent).not.toContain(
      "CLOUD_PURCHASE_PREFLIGHT_REQUIRED",
    );
    request.mockImplementation(normal);
    await act(async () => {
      await state.run("purchase");
    });
    expect(calls("preflightEcsPurchase")).toHaveLength(2);
    expect(calls("purchaseEcs")).toHaveLength(2);
  });

  it("无影保留原购买合同，无需 ECS 网络检查", async () => {
    await approve(initialWuyingSpec);
    await act(async () => {
      await state.run("purchase");
    });
    expect(calls("preflightEcsPurchase")).toHaveLength(0);
    expect(calls("purchaseWuying")).toHaveLength(1);
  });

  it.each([
    ["zh-CN", "正在检查网络", "网络检查未通过"],
    ["zh-TW", "正在檢查網路", "網路檢查未通過"],
    ["en-US", "Checking your network", "The network check failed"],
    ["ja-JP", "ネットワークを確認中", "ネットワークの確認に失敗"],
    ["ko-KR", "네트워크를 확인하고", "네트워크 확인에 실패"],
  ] as const)("%s 提供等待和失败反馈", async (locale, pending, failed) => {
    await changeLimeLocale(locale);
    await approve();
    let reject!: (cause: Error) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    act(() => {
      void state.run("purchase");
    });
    await settle();
    expect(container.textContent).toContain(pending);
    await act(async () => reject(Error("network")));
    await settle();
    expect(container.textContent).toContain(failed);
    expect(calls("purchaseEcs")).toHaveLength(0);
  });
});
