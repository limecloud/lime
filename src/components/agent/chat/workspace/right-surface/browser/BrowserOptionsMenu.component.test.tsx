import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNavigationContext } from "@/contexts/AppNavigationContext";
import { SettingsTabs } from "@/types/settings";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { BrowserWorkspaceOwner } from "@/lib/api/browserWorkspace";
import {
  browserState,
  createBrowserComponentHarness,
} from "./browserWorkspace.testFixtures";
import { BrowserOptionsMenu } from "./BrowserOptionsMenu";

const native = vi.hoisted(() => ({
  hook: vi.fn(),
  show: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./useBrowserNativeMenu", () => ({
  useBrowserNativeMenu: (params: unknown) => {
    native.hook(params);
    return { open: false, show: native.show, update: native.update };
  },
}));

let harness: ReturnType<typeof createBrowserComponentHarness>;
const navigate = vi.fn();
const error = vi.fn();
const owner = { runtimeSessionId: "runtime-session", threadId: "thread-1" };
const render = (
  canonicalOwner: BrowserWorkspaceOwner | null = owner,
  selected = browserState(),
) =>
  harness.render(
    <AppNavigationContext.Provider value={navigate}>
      <BrowserOptionsMenu
        owner={canonicalOwner}
        selected={selected}
        active
        run={vi.fn()}
        onFind={vi.fn()}
        onDeviceToggle={vi.fn()}
        onError={error}
      />
    </AppNavigationContext.Provider>,
  );
const choose = (itemId: string) =>
  act(async () => native.hook.mock.calls.at(-1)![0].onAction(itemId));

beforeEach(async () => {
  await changeLimeLocale("en-US");
  vi.clearAllMocks();
  native.show.mockResolvedValue(undefined);
  native.update.mockResolvedValue(undefined);
  harness = createBrowserComponentHarness();
});
afterEach(async () => {
  await harness.unmount();
  await changeLimeLocale("zh-CN");
});

describe("Browser options canonical return owner", () => {
  it.each([
    [0.25, false, true],
    [0.3, true, true],
    [4, true, true],
    [5, true, false],
  ])(
    "enables zoom controls for the shared native range at %s",
    async (zoomFactor, out, into) => {
      await render(owner, browserState({ zoomFactor }));
      await harness.dispatch(
        harness.query("browser-workspace-options"),
        new MouseEvent("click", { bubbles: true }),
      );
      const zoom = native.show.mock.calls
        .at(-1)![1]
        .find((item: { id?: string }) => item.id === "zoom");
      expect(
        zoom.controls.find((item: { id: string }) => item.id === "zoom-out")
          .enabled,
      ).toBe(out);
      expect(
        zoom.controls.find((item: { id: string }) => item.id === "zoom-in")
          .enabled,
      ).toBe(into);
    },
  );
  it.each(["history", "downloads", "settings"])(
    "captures the actual hydration owner for the %s settings route",
    async (item) => {
      await render();
      await choose(item);
      expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
        tab: SettingsTabs.Browser,
        ...(item === "history" || item === "downloads"
          ? { browserPage: item }
          : {}),
        browserReturnOwner: owner,
      });
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("never treats a Browser session or selected tab ID as the runtime session", async () => {
    await render(null);
    await choose("history");
    expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
      tab: SettingsTabs.Browser,
      browserPage: "history",
      browserReturnOwner: undefined,
    });
  });

  it("rejects a hydration owner that belongs to another canonical thread", async () => {
    await render({ ...owner, threadId: "stale-thread" });
    await choose("history");
    expect(navigate.mock.calls[0][1].browserReturnOwner).toBeUndefined();
  });

  it("uses the latest selected owner when the workspace switches threads", async () => {
    await render();
    const nextOwner = {
      runtimeSessionId: "runtime-next",
      threadId: "thread-next",
    };
    await render(
      nextOwner,
      browserState({ threadId: "thread-next", tabId: "next-tab" }),
    );
    await choose("settings");
    expect(navigate.mock.calls[0][1].browserReturnOwner).toEqual(nextOwner);
  });
});
