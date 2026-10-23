import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { getLimeI18n } from "@/i18n/createI18n";
import {
  BROWSER_DATA_TIME_RANGES,
  BROWSER_DATA_TYPES,
  type BrowserDataSettings,
  type BrowserDataSummary,
} from "@/lib/api/browserDataTypes";
import { BrowserClearBrowsingDataDialog } from "./BrowserClearBrowsingDataDialog";
import { useBrowserClearBrowsingData } from "./useBrowserClearBrowsingData";

const service = vi.hoisted(() => ({
  settings: vi.fn(),
  summary: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/lib/api/browserData", () => ({
  getBrowsingDataSettings: service.settings,
  getBrowsingDataSummary: service.summary,
  clearBrowsingData: service.clear,
}));
const policy = (): BrowserDataSettings => ({
  dataRemovalPermitted: {
    history: true,
    siteData: true,
    cache: true,
    downloads: true,
    formData: true,
    siteSettings: true,
  },
  supportedTimeRanges: {
    history: [...BROWSER_DATA_TIME_RANGES],
    siteData: ["allTime"],
    cache: ["allTime"],
    downloads: [...BROWSER_DATA_TIME_RANGES],
    formData: [],
    siteSettings: [],
  },
});
const summary = (site = "example.com"): BrowserDataSummary => ({
  history: { firstSite: site, siteCount: 2 },
  siteData: { siteCount: 3 },
  cache: { sizeBytes: 1536 },
  downloads: { count: 4 },
});
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useBrowserClearBrowsingData>;
function Harness() {
  controller = useBrowserClearBrowsingData();
  return (
    <>
      <button
        ref={controller.triggerRef}
        onClick={() => void controller.open()}
      >
        Open
      </button>
      <BrowserClearBrowsingDataDialog controller={controller} />
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const dialog = () => document.querySelector<HTMLElement>("[role=dialog]");
const textButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  )!;
const checkbox = (type: string) =>
  document.getElementById(
    `browser-clear-browsing-data-${type}`,
  ) as HTMLButtonElement;
const click = async (node: HTMLElement) => {
  await act(async () => node.click());
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  service.settings.mockReset().mockResolvedValue(policy());
  service.summary.mockReset().mockResolvedValue(summary());
  service.clear.mockReset().mockResolvedValue({
    status: "completed",
    dataTypes: ["history", "siteData", "cache", "downloads"],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

describe("Clear browsing data interactions", () => {
  it("waits for policy before opening, prevents opening twice, and resets policy-filtered defaults on reopen", async () => {
    const pending = deferred<BrowserDataSettings>();
    service.settings.mockReturnValueOnce(pending.promise);
    await act(async () => {
      void controller.open();
      void controller.open();
    });
    expect(service.settings).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    const settings = policy();
    settings.dataRemovalPermitted.history = false;
    await act(async () => pending.resolve(settings));
    expect(checkbox("history").disabled).toBe(true);
    expect(checkbox("history").getAttribute("aria-checked")).toBe("false");
    expect(
      BROWSER_DATA_TYPES.map((type) =>
        checkbox(type).getAttribute("aria-checked"),
      ),
    ).toEqual(["false", "true", "true", "true", "false", "false"]);
    expect(
      [...dialog()!.querySelectorAll("[role=checkbox]")].map((node) => node.id),
    ).toEqual(
      BROWSER_DATA_TYPES.map((type) => `browser-clear-browsing-data-${type}`),
    );
    await click(textButton("All time"));
    await click(checkbox("formData"));
    await click(textButton("Cancel"));
    await click(textButton("Open"));
    expect(textButton("Last hour").getAttribute("aria-pressed")).toBe("true");
    expect(checkbox("formData").getAttribute("aria-checked")).toBe("false");
    expect(checkbox("history").getAttribute("aria-checked")).toBe("true");
  });
  it("keeps opening failures closed and allows retry", async () => {
    service.settings.mockRejectedValueOnce(new Error("unavailable"));
    await click(textButton("Open"));
    expect(dialog()).toBeNull();
    expect(controller.error).toEqual({ kind: "open" });
    await click(textButton("Open"));
    expect(dialog()).not.toBeNull();
  });
  it("ignores old range previews and does not invent zero for unavailable summaries", async () => {
    const old = deferred<BrowserDataSummary>();
    service.summary
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(summary("fresh.example"));
    await click(textButton("Open"));
    await click(textButton("Last 4 weeks"));
    expect(dialog()!.textContent).toContain("fresh.example");
    await act(async () => old.resolve(summary("stale.example")));
    expect(dialog()!.textContent).not.toContain("stale.example");
    expect(service.summary).toHaveBeenLastCalledWith("lastMonth");
    service.summary.mockRejectedValueOnce(new Error("unavailable"));
    await click(textButton("All time"));
    expect(
      document.getElementById("browser-clear-browsing-data-cache-description"),
    ).toBeNull();
    expect(dialog()!.textContent).toContain("Saved names, addresses");
  });
  it("keeps the current preview when the selected range is activated again", async () => {
    await click(textButton("Open"));
    expect(dialog()!.textContent).toContain("example.com");
    await click(textButton("Last hour"));
    expect(dialog()!.textContent).toContain("example.com");
    expect(service.summary).toHaveBeenCalledOnce();
  });
  it("ignores previews and clearing results after unmount", async () => {
    const preview = deferred<BrowserDataSummary>();
    const result = deferred<{ status: "completed"; dataTypes: ["history"] }>();
    service.summary.mockReturnValueOnce(preview.promise);
    service.clear.mockReturnValueOnce(result.promise);
    await click(textButton("Open"));
    await act(async () => {
      void controller.clear();
    });
    await act(async () => root.render(<div>Unmounted</div>));
    await act(async () => {
      preview.resolve(summary("late.example"));
      result.resolve({ status: "completed", dataTypes: ["history"] });
    });
    expect(dialog()).toBeNull();
    expect(container.textContent).toBe("Unmounted");
  });
  it("supports label activation and rejects empty selection in both view and controller", async () => {
    await click(textButton("Open"));
    await click(
      document.querySelector<HTMLLabelElement>(
        'label[for="browser-clear-browsing-data-formData"]',
      )!,
    );
    expect(checkbox("formData").getAttribute("aria-checked")).toBe("true");
    for (const type of [
      "history",
      "siteData",
      "cache",
      "downloads",
      "formData",
    ])
      await click(checkbox(type));
    expect(textButton("Delete data").disabled).toBe(true);
    await act(async () => controller.clear());
    expect(service.clear).not.toHaveBeenCalled();
  });
  it("locks synchronously, blocks Escape/outside/Cancel and all edits until completion, then restores focus", async () => {
    const pending = deferred<{ status: "completed"; dataTypes: ["history"] }>();
    service.clear.mockReturnValueOnce(pending.promise);
    await click(textButton("Open"));
    expect(document.activeElement).toBe(textButton("Last hour"));
    await act(async () => {
      void controller.clear();
      void controller.clear();
      controller.close();
      controller.changeTimeRange("allTime");
      controller.toggle("formData");
    });
    expect(service.clear).toHaveBeenCalledOnce();
    expect(controller.timeRange).toBe("lastHour");
    expect(dialog()).not.toBeNull();
    expect(
      [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    await act(async () => {
      dialog()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(dialog()).not.toBeNull();
    await act(async () =>
      pending.resolve({ status: "completed", dataTypes: ["history"] }),
    );
    expect(dialog()).toBeNull();
    // Radix restores focus after its unmount task.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(textButton("Open"));
  });
  it("retains selection and range on unsupported, partial and transport failures", async () => {
    service.clear
      .mockResolvedValueOnce({
        status: "unsupported",
        dataTypes: ["siteData", "cache"],
      })
      .mockResolvedValueOnce({
        status: "failed",
        clearedDataTypes: ["history"],
        failedDataTypes: ["siteData"],
        pendingDataTypes: ["cache", "downloads"],
      })
      .mockRejectedValueOnce(new Error("transport lost"));
    await click(textButton("Open"));
    await click(textButton("Delete data"));
    expect(dialog()!.querySelector("[role=alert]")!.textContent).toContain(
      "No data has been deleted",
    );
    expect(controller.selected).toEqual([
      "history",
      "siteData",
      "cache",
      "downloads",
    ]);
    await click(textButton("Delete data"));
    expect(dialog()!.querySelector("[role=alert]")!.textContent).toContain(
      "Some data may have been deleted",
    );
    await click(textButton("Delete data"));
    expect(dialog()!.querySelector("[role=alert]")!.textContent).toContain(
      "Unable to confirm",
    );
    expect(textButton("Last hour").getAttribute("aria-pressed")).toBe("true");
    expect(textButton("Delete data").disabled).toBe(false);
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "renders six named checkboxes and five named time controls in %s",
    async (locale) => {
      await act(async () => changeLimeLocale(locale));
      await click(textButton("Open"));
      const t = getLimeI18n().getFixedT(locale, "settings");
      expect(dialog()!.getAttribute("aria-labelledby")).toBeTruthy();
      expect(dialog()!.textContent).toContain(t("browserData.title"));
      for (const type of BROWSER_DATA_TYPES) {
        const label = document.getElementById(
          checkbox(type).getAttribute("aria-labelledby")!,
        );
        expect(label!.textContent).toBe(t(`browserData.type.${type}`));
      }
      for (const range of BROWSER_DATA_TIME_RANGES)
        expect(textButton(t(`browserData.range.${range}`))).toBeDefined();
      expect(dialog()!.textContent).not.toMatch(/browserData\.|\{\{/u);
    },
  );
});
