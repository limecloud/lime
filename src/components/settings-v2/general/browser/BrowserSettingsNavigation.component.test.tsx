import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppNavigationContext } from "@/contexts/AppNavigationContext";
import { changeLimeLocale } from "@/i18n/createI18n";
import { useBrowserHistoryNavigation } from "@/hooks/useBrowserHistoryNavigation";
import type { SettingsPageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { BrowserUseSettings } from "./index";

vi.mock("./useBrowserSettings", async () => {
  const { DEFAULT_BROWSER_SETTINGS } =
    await import("@/lib/api/browserSettings");
  return {
    useBrowserSettings: () => ({
      configured: DEFAULT_BROWSER_SETTINGS,
      permissionContext: {
        origins: {},
        userPermissions: DEFAULT_BROWSER_SETTINGS.agent_permissions,
      },
      pending: false,
      error: null,
    }),
  };
});
vi.mock("@/hooks/useDesktopPreferences", () => ({
  useDesktopPreferences: () => ({
    configured: {},
    pending: false,
    error: null,
  }),
}));
vi.mock("./BrowserHistoryPage", () => ({
  BrowserHistoryPage: ({ onBack }: { onBack: () => void }) => (
    <button data-testid="history-page" onClick={onBack}>
      Return
    </button>
  ),
}));
vi.mock("./BrowserDownloadsPage", () => ({
  BrowserDownloadsPage: ({ onBack }: { onBack: () => void }) => (
    <button data-testid="downloads-page" onClick={onBack}>
      Return
    </button>
  ),
}));

const owner = {
  runtimeSessionId: "session",
  threadId: "thread",
  workspaceId: "workspace",
};
let container: HTMLDivElement;
let root: Root;
let route: SettingsPageParams;
let navigation: ReturnType<typeof useBrowserHistoryNavigation>;
let blocked: boolean;
const navigate = vi.fn();

function Harness({ initial }: { initial?: SettingsPageParams }) {
  const [params, setParams] = useState<SettingsPageParams>(
    initial ?? {
      tab: SettingsTabs.Browser,
      browserReturnOwner: owner,
    },
  );
  route = params;
  navigation = useBrowserHistoryNavigation({
    page: "settings",
    pageParams: params,
    navigationRequestId: 1,
    agentLocation: null,
    settingsReturnLocation: null,
    navigate: (page, next) => {
      navigate(page, next);
      if (!blocked) setParams(next as SettingsPageParams);
    },
    tryNavigate: () => false,
  });
  return (
    <AppNavigationContext.Provider value={navigation.navigateFromBrowser}>
      <BrowserUseSettings page={params.browserPage} />
    </AppNavigationContext.Provider>
  );
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  navigate.mockReset();
  blocked = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

const manage = (page: "history" | "downloads") =>
  container.querySelector<HTMLButtonElement>(
    `#browser-${page === "history" ? "history" : "download-history"} button`,
  )!;

it.each(["history", "downloads"] as const)(
  "uses the application route for %s, returns focus and supports reopening",
  async (page) => {
    await act(async () => root.render(<Harness />));
    await act(async () => manage(page).click());
    expect(route).toEqual({
      tab: SettingsTabs.Browser,
      browserPage: page,
      browserReturnOwner: owner,
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[data-testid=${page}-page]`)!
        .click(),
    );
    expect(route.browserPage).toBeUndefined();
    expect(route.browserReturnOwner).toEqual(owner);
    expect(document.activeElement).toBe(manage(page));
    await act(async () => manage(page).click());
    expect(route.browserPage).toBe(page);
  },
);

it("does not enter a local subpage when the application navigation guard rejects it", async () => {
  blocked = true;
  await act(async () => root.render(<Harness />));
  await act(async () => manage("history").click());
  expect(navigate).toHaveBeenCalledOnce();
  expect(route.browserPage).toBeUndefined();
  expect(manage("history")).not.toBeNull();
  expect(container.querySelector("[data-testid=history-page]")).toBeNull();
});

it("returns a directly opened subpage through the same application route", async () => {
  await act(async () =>
    root.render(
      <Harness
        initial={{
          tab: SettingsTabs.Browser,
          browserPage: "history",
          browserReturnOwner: owner,
        }}
      />,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-testid=history-page]")!
      .click(),
  );
  expect(route.browserPage).toBeUndefined();
  expect(route.browserReturnOwner).toEqual(owner);
  expect(document.activeElement).toBe(manage("history"));
});

it("preserves the established return owner across Settings routes and rejects a replacement", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () =>
    navigation.navigateFromBrowser("settings", {
      tab: SettingsTabs.General,
      browserReturnOwner: { ...owner, threadId: "forged-thread" },
    }),
  );
  expect(route).toEqual({
    tab: SettingsTabs.General,
    browserReturnOwner: owner,
  });
});

it("does not invent a return owner when ordinary Settings has none", async () => {
  await act(async () =>
    root.render(<Harness initial={{ tab: SettingsTabs.Browser }} />),
  );
  await act(async () =>
    navigation.navigateFromBrowser("settings", {
      tab: SettingsTabs.Browser,
      browserPage: "downloads",
      browserReturnOwner: owner,
    }),
  );
  expect(route).toEqual({
    tab: SettingsTabs.Browser,
    browserPage: "downloads",
  });
});
