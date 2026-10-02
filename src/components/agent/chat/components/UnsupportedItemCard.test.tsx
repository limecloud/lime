import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AgentThreadItem } from "../types";
import { UnsupportedItemCard } from "./UnsupportedItemCard";

const item: AgentThreadItem = {
  id: "unknown-item-1",
  thread_id: "thread-1",
  turn_id: "turn-1",
  sequence: 1,
  status: "completed",
  type: "unknown_item",
  upstream_type: "futureCapability",
  field_names: ["[redacted]", "label", "opaquePayload", "status"],
};

describe("UnsupportedItemCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["zh-CN", "暂时无法显示这条记录", "诊断详情", "记录类型："],
    ["zh-TW", "暫時無法顯示這條記錄", "診斷詳情", "記錄類型："],
    [
      "en-US",
      "This record cannot be displayed yet",
      "Diagnostics",
      "Record type: ",
    ],
    ["ja-JP", "この記録はまだ表示できません", "診断の詳細", "記録の種類: "],
    [
      "ko-KR",
      "이 기록은 아직 표시할 수 없습니다",
      "진단 상세 정보",
      "기록 유형: ",
    ],
  ])(
    "keeps protocol details collapsed in %s",
    async (locale, title, label, typeLabel) => {
      await changeLimeLocale(locale);
      act(() => root.render(<UnsupportedItemCard item={item} />));

      const details = container.querySelector("details")!;
      const summary = details.querySelector("summary")!;
      const mainContent = container.cloneNode(true) as HTMLDivElement;
      mainContent.querySelector("details")?.remove();
      expect(mainContent.textContent).toContain(title);
      expect(mainContent.textContent).not.toContain("futureCapability");
      expect(mainContent.textContent).not.toContain("opaquePayload");
      expect(summary.textContent).toBe(label);
      expect(details.open).toBe(false);

      act(() => summary.click());
      expect(details.open).toBe(true);
      expect(details.textContent).toContain(`${typeLabel}futureCapability`);
      expect(details.textContent).toContain(
        "[redacted], label, opaquePayload, status",
      );
      expect(container.textContent).not.toContain("unknown_item");

      act(() => summary.click());
      expect(details.open).toBe(false);
    },
  );

  it("never renders raw metadata even after diagnostics are expanded", async () => {
    await changeLimeLocale("zh-CN");
    const unsupported = {
      ...item,
      type: "runtime_protocol_diagnostic",
      metadata: {
        secretToken: "SECRET_MUST_NOT_LEAK",
        raw_payload: { method: "turn/start", opaquePayload: "private value" },
      },
    } as unknown as AgentThreadItem;
    act(() => root.render(<UnsupportedItemCard item={unsupported} />));
    const summary = container.querySelector("summary")!;
    act(() => summary.click());

    expect(container.textContent).toContain(
      "记录类型：runtime_protocol_diagnostic",
    );
    for (const value of [
      "SECRET_MUST_NOT_LEAK",
      "raw_payload",
      "turn/start",
      "private value",
    ]) {
      expect(container.textContent).not.toContain(value);
    }
  });
});
