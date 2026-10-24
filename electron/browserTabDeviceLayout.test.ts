import { describe, expect, it } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";

describe("Browser device container routing", () => {
  it("selects repeatedly and restores a closed tab's neighbor using the full container", async () => {
    const harness = createHarness();
    const container = { x: 100, y: 50, width: 1000, height: 800 };
    const state = (await mount(harness, { bounds: container })) as {
      viewId: string;
    };
    const native = harness.views.get(state.viewId)!;
    native.view.getBounds = () => ({ x: 400, y: 50, width: 300, height: 600 });
    for (let i = 0; i < 2; i++) {
      await harness.host.invoke(harness.window as never, "browser_tab_select", {
        tabId: "tab-1",
      });
      expect(harness.embeddedHost.invoke).toHaveBeenLastCalledWith(
        harness.window,
        "embedded_browser_view_set_bounds",
        {
          viewId: state.viewId,
          bounds: container,
          visible: true,
        },
      );
    }
    await mount(harness, { tabId: "tab-2", bounds: container });
    await harness.host.invoke(harness.window as never, "browser_tab_close", {
      tabId: "tab-2",
    });
    expect(harness.embeddedHost.invoke).toHaveBeenLastCalledWith(
      harness.window,
      "embedded_browser_view_set_bounds",
      {
        viewId: state.viewId,
        bounds: container,
        visible: true,
      },
    );
    expect(native.containerBounds).toEqual(container);
  });
});
