import { act, StrictMode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import { MarketplaceSettings } from "./MarketplaceSettings";
import {
  useMarketplaceSettings,
  type SettingsMarketplace,
} from "./useMarketplaceSettings";

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getConfig: vi.fn(),
  listPlugins: vi.fn(),
  installed: vi.fn(),
  remove: vi.fn(),
  upgrade: vi.fn(),
  uninstall: vi.fn(),
  markets: [] as SettingsMarketplace[],
  config: {} as Record<string, { source_type: string }>,
}));
vi.mock("@/lib/api/project", () => ({ listProjects: api.listProjects }));
vi.mock("@/lib/api/appConfig", () => ({ getConfig: api.getConfig }));
vi.mock("@/lib/api/pluginCatalog", () => ({
  listPlugins: api.listPlugins,
  listInstalledPlugins: api.installed,
  removeMarketplace: api.remove,
  upgradeMarketplace: api.upgrade,
  uninstallPlugin: api.uninstall,
  PLUGIN_CATALOG_CHANGED_EVENT: "test:marketplace-changed",
}));
let root: Root, container: HTMLDivElement;
function Surface() {
  const refresh = useRef<HTMLButtonElement>(null);
  const controller = useMarketplaceSettings();
  return (
    <>
      <button
        ref={refresh}
        data-testid="refresh"
        onClick={() => void controller.reload()}
      >
        Refresh fixture
      </button>
      <MarketplaceSettings controller={controller} refreshButton={refresh} />
    </>
  );
}
const plugin = (id: string): AppServerPluginSummary => ({
  id,
  name: id.split("@")[0],
  installed: true,
  enabled: true,
  source: { type: "local", path: `/fixture/${id}` },
  installPolicy: "AVAILABLE",
  authPolicy: "ON_USE",
  availability: "AVAILABLE",
  interface: null,
  keywords: [],
});
const market = (
  name = "team",
  path = `/fixture/${name}/marketplace.json`,
  plugins = [plugin("alpha@team"), plugin("beta@team")],
): SettingsMarketplace => ({
  name,
  path,
  plugins,
  interface: { displayName: `${name} display` },
});
const response = (markets = api.markets) => ({
  marketplaces: structuredClone(markets),
  marketplaceLoadErrors: [],
});
const mount = async (strict = false) =>
  act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <Surface />
        </StrictMode>
      ) : (
        <Surface />
      ),
    ),
  );
const click = async (element: HTMLElement) => act(async () => element.click());
const named = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.getAttribute("aria-label") === name || button.textContent === name,
  )!;
const dialog = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');
const confirm = () =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].at(-1)!;
const open = () => click(named("Remove team display"));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.markets = [market()];
  api.config = { team: { source_type: "git" } };
  api.listProjects.mockResolvedValue([
    { rootPath: "/project" },
    { rootPath: "/project" },
    { rootPath: "/archived", isArchived: true },
  ]);
  api.getConfig.mockImplementation(async () => ({
    marketplaces: structuredClone(api.config),
  }));
  api.listPlugins.mockImplementation(async () => response());
  api.installed.mockImplementation(async () => response());
  api.uninstall.mockImplementation(
    async ({ pluginId }: { pluginId: string }) => {
      for (const entry of api.markets)
        for (const item of entry.plugins)
          if (item.id === pluginId) item.installed = false;
    },
  );
  api.remove.mockImplementation(
    async ({ marketplaceName }: { marketplaceName: string }) => {
      delete api.config[marketplaceName];
      api.markets = api.markets.filter((item) => item.name !== marketplaceName);
    },
  );
  api.upgrade.mockImplementation(
    async ({ marketplaceName }: { marketplaceName: string }) => ({
      selectedMarketplaces: [marketplaceName],
      upgradedRoots: ["/fixture/team"],
      errors: [],
    }),
  );
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("uses active roots and canonical market identities, count, path and display metadata", async () => {
  api.markets.push(structuredClone(api.markets[0]));
  await mount();
  expect(api.listPlugins).toHaveBeenCalledWith({
    cwds: ["/project"],
    marketplaceKinds: ["local"],
    forceRefetch: true,
  });
  expect(container.querySelectorAll("[data-marketplace-key]")).toHaveLength(1);
  expect(container.textContent).toContain("team display");
  expect(container.textContent).toContain("2 plugins");
  expect(container.textContent).toContain("/fixture/team/marketplace.json");
});
it("only allows configured unique marketplaces to be removed and configured Git sources to upgrade", async () => {
  api.markets.push(market("built-in"), market("local"));
  api.config.local = { source_type: "local" };
  await mount();
  expect(named("Remove built-in display").disabled).toBe(true);
  expect(named("Upgrade built-in display").disabled).toBe(true);
  expect(named("Remove local display").disabled).toBe(false);
  expect(named("Upgrade local display").disabled).toBe(true);
  expect(named("Upgrade team display").disabled).toBe(false);
});
it("rejects duplicate market names with distinct manifest paths", async () => {
  api.markets.push(market("team", "/other/marketplace.json"));
  await mount();
  expect(
    [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Remove"]',
      ),
    ].every((button) => button.disabled),
  ).toBe(true);
  expect(
    [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Upgrade"]',
      ),
    ].every((button) => button.disabled),
  ).toBe(true);
});
it("keeps load failure distinct from an empty catalog and permits read-only retry", async () => {
  api.listPlugins.mockRejectedValueOnce(new Error("read failure"));
  await mount();
  expect(container.textContent).toContain("Unable to load marketplaces.");
  expect(container.textContent).not.toContain("No marketplaces found");
  await click(named("Retry"));
  expect(container.querySelectorAll("[data-marketplace-key]")).toHaveLength(1);
  expect(api.remove).not.toHaveBeenCalled();
});
it("reads installed plugins before confirmation and uninstalls exact IDs before removing the market", async () => {
  const order: string[] = [];
  api.uninstall.mockImplementation(async ({ pluginId }) => {
    order.push(pluginId);
  });
  api.remove.mockImplementation(async () => {
    order.push("remove");
    api.config = {};
    api.markets = [];
  });
  await mount();
  await open();
  expect(api.installed).toHaveBeenCalledWith({ cwds: ["/project"] });
  expect(dialog()!.textContent).toContain("alpha");
  expect(dialog()!.textContent).toContain("beta");
  await click(confirm());
  expect(order).toEqual(["alpha@team", "beta@team", "remove"]);
  expect(api.remove).toHaveBeenCalledWith({ marketplaceName: "team" });
  expect(dialog()).toBeNull();
});
it("resumes remaining uninstalls after failure without repeating completed IDs", async () => {
  api.uninstall
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("beta failed"));
  await mount();
  await open();
  await click(confirm());
  expect(dialog()!.textContent).toContain("Uninstalled");
  expect(dialog()!.textContent).toContain(
    "Some plugins could not be uninstalled",
  );
  expect(api.remove).not.toHaveBeenCalled();
  await click(confirm());
  expect(api.uninstall.mock.calls.map(([params]) => params.pluginId)).toEqual([
    "alpha@team",
    "beta@team",
    "beta@team",
  ]);
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
});
it("blocks confirmation on installed-list failure and retries only the read", async () => {
  api.installed.mockRejectedValueOnce(new Error("read failed"));
  await mount();
  await open();
  expect(dialog()!.textContent).toContain("Unable to load installed plugins");
  expect(api.remove).not.toHaveBeenCalled();
  await click(confirm());
  expect(api.installed).toHaveBeenCalledTimes(2);
  expect(api.uninstall).not.toHaveBeenCalled();
  expect(confirm().textContent).toBe("Uninstall & remove");
});
it("rejects partial installed snapshots without uninstalling anything", async () => {
  api.installed.mockResolvedValueOnce({
    marketplaces: [],
    marketplaceLoadErrors: [
      { message: "source failed", marketplacePath: "/fixture" },
    ],
  });
  await mount();
  await open();
  expect(dialog()!.querySelector('[role="alert"]')).not.toBeNull();
  expect(api.uninstall).not.toHaveBeenCalled();
  expect(api.remove).not.toHaveBeenCalled();
});
it("does not repeat uninstalls when marketplace removal itself needs retry", async () => {
  api.remove.mockRejectedValueOnce(new Error("remove failed"));
  await mount();
  await open();
  await click(confirm());
  expect(dialog()!.textContent).toContain("Unable to remove the marketplace");
  await click(confirm());
  expect(api.uninstall).toHaveBeenCalledTimes(2);
  expect(api.remove).toHaveBeenCalledTimes(2);
});
it("only re-reads after saved removal cannot be confirmed", async () => {
  api.remove.mockImplementationOnce(async () => {
    api.config = {};
    api.markets = [];
    api.listPlugins.mockRejectedValueOnce(new Error("confirmation failed"));
  });
  await mount();
  await open();
  await click(confirm());
  expect(dialog()!.textContent).toContain("Removal was saved");
  await click(confirm());
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(api.uninstall).toHaveBeenCalledTimes(2);
  expect(dialog()).toBeNull();
});
it("does not claim success for an overridden removal", async () => {
  api.remove.mockResolvedValueOnce({ marketplaceName: "team" });
  await mount();
  await open();
  await click(confirm());
  expect(dialog()!.textContent).toContain("Removal was saved");
  await click(confirm());
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(dialog()).not.toBeNull();
});
it("blocks duplicate confirmation and cancellation while writes are in flight", async () => {
  const write = deferred<void>();
  api.uninstall.mockReturnValueOnce(write.promise);
  await mount();
  await open();
  await click(confirm());
  expect(confirm().disabled).toBe(true);
  expect(named("Cancel").disabled).toBe(true);
  await click(confirm());
  expect(api.uninstall).toHaveBeenCalledTimes(1);
  await act(async () => write.resolve());
  expect(dialog()).toBeNull();
});
it("reports partial upgrade failure and retries the same canonical marketplace", async () => {
  api.upgrade.mockResolvedValueOnce({
    selectedMarketplaces: ["team"],
    upgradedRoots: [],
    errors: [{ marketplaceName: "team", message: "failure" }],
  });
  await mount();
  await click(named("Upgrade team display"));
  expect(container.textContent).toContain(
    "Unable to complete the marketplace upgrade",
  );
  await click(named("Retry"));
  expect(api.upgrade.mock.calls).toEqual([
    [{ marketplaceName: "team" }],
    [{ marketplaceName: "team" }],
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("queued catalog changes cannot clear a failed upgrade", async () => {
  api.upgrade.mockImplementationOnce(async () => {
    window.dispatchEvent(new Event("test:marketplace-changed"));
    return { selectedMarketplaces: ["team"], upgradedRoots: [], errors: [{}] };
  });
  await mount();
  await click(named("Upgrade team display"));
  expect(container.textContent).toContain(
    "Unable to complete the marketplace upgrade",
  );
  expect(api.listPlugins).toHaveBeenCalledTimes(2);
});

it("does not repeat an upgrade after a successful write with failed readback", async () => {
  api.upgrade.mockImplementationOnce(async () => {
    api.listPlugins.mockRejectedValueOnce(new Error("confirmation failed"));
    return {
      selectedMarketplaces: ["team"],
      upgradedRoots: ["/fixture/team"],
      errors: [],
    };
  });
  await mount();
  await click(named("Upgrade team display"));
  expect(container.textContent).toContain("Upgrade was saved");
  await click(named("Retry"));
  expect(api.upgrade).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("validates current configuration and path before preparing destructive actions", async () => {
  await mount();
  api.markets = [market("team", "/changed/marketplace.json")];
  await open();
  expect(dialog()!.textContent).toContain("Unable to load installed plugins");
  expect(api.installed).not.toHaveBeenCalled();
  expect(api.uninstall).not.toHaveBeenCalled();
});
it("moves focus to the persistent refresh action when the removed row disappears", async () => {
  await mount();
  await open();
  await click(confirm());
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="refresh"]'),
    ),
  );
});
it("ignores old StrictMode responses", async () => {
  const old = deferred<ReturnType<typeof response>>();
  api.listPlugins.mockReturnValueOnce(old.promise);
  await mount(true);
  expect(container.textContent).toContain("team display");
  await act(async () => old.resolve(response([market("stale")])));
  expect(container.textContent).not.toContain("stale display");
});
it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "renders count, actions and dialog through %s resources",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    const remove = container.querySelector<HTMLButtonElement>(
      "button[aria-label]:last-child",
    )!;
    await click(remove);
    expect(container.textContent).not.toMatch(/settings\./);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).not.toMatch(/settings\./);
    expect(dialog()!.querySelectorAll("button")).toHaveLength(2);
  },
);
