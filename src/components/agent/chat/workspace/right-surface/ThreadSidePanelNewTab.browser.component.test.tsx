import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ThreadSidePanelNewTab } from "./ThreadSidePanelNewTab";
import { RightSurfaceTabContext } from "./rightSurfaceTabContext";
import { WorkspaceBrowserNavigationContext } from "./browser/workspaceBrowserNavigationContext";
import { createBrowserComponentHarness } from "./browser/browserWorkspace.testFixtures";

let harness: ReturnType<typeof createBrowserComponentHarness>;
const openAddress = vi.fn();
const onActionSelect = vi.fn();
const render = (navigation = true, presentation = true) => {
  const page = (
    <ThreadSidePanelNewTab actions={[]} onActionSelect={onActionSelect} />
  );
  return harness.render(
    <WorkspaceBrowserNavigationContext.Provider
      value={navigation ? { openAddress } : null}
    >
      <RightSurfaceTabContext.Provider
        value={
          presentation
            ? {
                active: true,
                tab: { tabId: "new-tab-source", kind: "workspace-new-tab" },
              }
            : null
        }
      >
        {page}
      </RightSurfaceTabContext.Provider>
    </WorkspaceBrowserNavigationContext.Provider>,
  );
};
describe("New tab Browser navigation", () => {
  beforeEach(async () => {
    await changeLimeLocale("en-US");
    harness = createBrowserComponentHarness();
    openAddress.mockReset().mockResolvedValue(undefined);
    onActionSelect.mockReset();
  });
  afterEach(async () => {
    await harness.unmount();
    await changeLimeLocale("zh-CN");
  });
  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    "requires both real navigation and source tab context: %s/%s",
    async (navigation, presentation) => {
      await render(navigation, presentation);
      expect(
        document.querySelector("[data-testid=browser-new-tab-address]"),
      ).toBeNull();
    },
  );
  it("opens through canonical navigation context with the source tab, without invoking tools or recents", async () => {
    await render();
    const input = harness.query<HTMLInputElement>("browser-new-tab-address");
    await harness.change(input, "localhost:5173");
    await harness.dispatch(
      input.closest("form")!,
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(openAddress).toHaveBeenCalledExactlyOnceWith(
      "new-tab-source",
      "http://localhost:5173/",
    );
    expect(onActionSelect).not.toHaveBeenCalled();
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "uses the existing localized address and failure labels in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      openAddress.mockRejectedValue(new Error("fixture rejected"));
      await render();
      const input = harness.query<HTMLInputElement>("browser-new-tab-address");
      expect(input.placeholder).not.toContain("agentChat.");
      expect(input.getAttribute("aria-label")).toBe(input.placeholder);
      await harness.change(input, "example.com");
      await act(async () =>
        input
          .closest("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      const alert = document.querySelector("[role=alert]");
      expect(alert?.textContent?.trim()).toBeTruthy();
      expect(alert?.textContent).not.toContain("agentChat.");
    },
  );
});
