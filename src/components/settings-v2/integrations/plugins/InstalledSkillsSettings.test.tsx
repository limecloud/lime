import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AppServerSkillsListResponse } from "@/lib/api/appServerTypes";
import type { AppServerEventBusSubscription } from "@/lib/api/appServerEventBus";
import { InstalledSkillsSettings } from "./InstalledSkillsSettings";
import { useSkillsSettings, type SettingsSkill } from "./useSkillsSettings";

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listSkills: vi.fn(),
  write: vi.fn(),
  navigate: vi.fn(),
  unsubscribe: vi.fn(),
  subscriptions: [] as AppServerEventBusSubscription[],
  data: [] as AppServerSkillsListResponse["data"],
}));
vi.mock("@/lib/api/project", () => ({ listProjects: api.listProjects }));
vi.mock("@/lib/api/appServerClient", () => ({
  createAppServerClient: () => ({ listSkills: api.listSkills }),
}));
vi.mock("@/lib/api/skillConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/skillConfig")>()),
  writeProtocolSkillEnabled: api.write,
}));
vi.mock("@/lib/api/appServerEventBus", () => ({
  subscribeAppServerNotifications: (
    subscription: AppServerEventBusSubscription,
  ) => {
    api.subscriptions.push(subscription);
    return api.unsubscribe;
  },
}));

let root: Root;
let container: HTMLDivElement;
const skill = (
  path = "/project/alpha/SKILL.md",
  extra: Partial<SettingsSkill> = {},
): SettingsSkill => ({
  name: "alpha",
  description: "Skill description",
  path,
  enabled: true,
  scope: "user",
  ...extra,
});
const entry = (skills = [skill()]) => ({ cwd: "/project", errors: [], skills });
function Surface() {
  const controller = useSkillsSettings();
  return (
    <InstalledSkillsSettings
      controller={controller}
      onNavigate={api.navigate}
    />
  );
}
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
const toggle = (index = 0) =>
  container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[index];
const retry = () =>
  click(container.querySelector<HTMLButtonElement>('[role="alert"] button')!);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
const notify = (index = api.subscriptions.length - 1) =>
  act(async () =>
    api.subscriptions[index].onNotifications?.([
      { jsonrpc: "2.0", method: "skills/changed", params: {} },
    ]),
  );

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.subscriptions = [];
  api.data = [entry()];
  api.listProjects.mockResolvedValue([
    { rootPath: "/project" },
    { rootPath: "/project" },
    { rootPath: "/archived", isArchived: true },
  ]);
  api.listSkills.mockImplementation(async () => ({
    result: structuredClone({ data: api.data }),
  }));
  api.write.mockImplementation(
    async ({ path, enabled }: { path: string; enabled: boolean }) => {
      for (const group of api.data)
        for (const item of group.skills)
          if (item.path === path) item.enabled = enabled;
      return enabled;
    },
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

it("deduplicates canonical paths across active project roots and preserves metadata", async () => {
  api.data = [
    entry([
      skill(undefined, {
        interface: {
          displayName: "Alpha display",
          shortDescription: "Short metadata",
        },
      }),
    ]),
    entry(),
  ];
  await mount();
  expect(api.listSkills).toHaveBeenCalledWith({
    cwds: ["/project"],
    forceReload: true,
  });
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
  expect(container.textContent).toContain("Alpha display");
  expect(container.textContent).toContain("Short metadata");
});
it("uses exact paths for skills with duplicate names and confirms the canonical readback", async () => {
  api.data = [entry([skill(), skill("C:\\project\\alpha\\SKILL.md")])];
  await mount();
  await click(toggle(1));
  expect(api.write).toHaveBeenCalledWith({
    path: "C:\\project\\alpha\\SKILL.md",
    enabled: false,
  });
  expect(toggle(0).getAttribute("aria-checked")).toBe("true");
  expect(toggle(1).getAttribute("aria-checked")).toBe("false");
  expect(api.listSkills).toHaveBeenCalledTimes(2);
});
it("opens the existing installed skill directory with the canonical name", async () => {
  await mount();
  await click(
    container.querySelector<HTMLButtonElement>('button:not([role="switch"])')!,
  );
  expect(api.navigate).toHaveBeenCalledWith("skills", {
    initialSearchQuery: "alpha",
    initialView: "installed",
  });
});
it("keeps the confirmed state on a failed write and permits a retry", async () => {
  await mount();
  api.write.mockRejectedValueOnce(new Error("write denied"));
  await click(toggle());
  expect(container.textContent).toContain("Unable to update the skill.");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await click(toggle());
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("retries only the read after a committed write and failed refresh", async () => {
  await mount();
  api.listSkills.mockRejectedValueOnce(new Error("read failed"));
  await click(toggle());
  expect(container.textContent).toContain("The change was saved");
  expect(toggle().disabled).toBe(true);
  await retry();
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("reports an overridden setting instead of claiming the requested value was applied", async () => {
  await mount();
  api.write.mockResolvedValueOnce(true);
  await click(toggle());
  expect(container.textContent).toContain("overridden");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});
it("retains the complete list when a later scan contains errors", async () => {
  await mount();
  api.listSkills.mockResolvedValueOnce({
    result: {
      data: [
        { ...entry([]), errors: [{ path: "/broken", message: "invalid" }] },
      ],
    },
  });
  await notify();
  expect(container.textContent).toContain("Unable to load skills.");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("No skills found");
});
it("does not display an empty success state after the initial read fails", async () => {
  api.listSkills.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(container.textContent).toContain("Unable to load skills.");
  expect(container.textContent).not.toContain("No skills found");
  await retry();
  expect(toggle()).toBeDefined();
});
it("serializes repeated toggles and queues skills/changed during the mutation", async () => {
  await mount();
  const pending = deferred<boolean>();
  api.write.mockReturnValueOnce(pending.promise);
  await click(toggle());
  await click(toggle());
  await notify();
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(api.listSkills).toHaveBeenCalledTimes(1);
  api.data[0].skills[0].enabled = false;
  await act(async () => pending.resolve(false));
  expect(api.listSkills).toHaveBeenCalledTimes(3);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});
it("ignores stale scans and stale notifications from the StrictMode subscription", async () => {
  const old = deferred<{ result: AppServerSkillsListResponse }>();
  api.listProjects.mockResolvedValueOnce([{ rootPath: "/old" }]);
  api.listSkills.mockReturnValueOnce(old.promise);
  await mount(true);
  await act(async () =>
    old.resolve({
      result: { data: [entry([skill("/stale/SKILL.md", { name: "stale" })])] },
    }),
  );
  expect(container.textContent).not.toContain("stale");
  const calls = api.listSkills.mock.calls.length;
  await notify(0);
  expect(api.listSkills).toHaveBeenCalledTimes(calls);
});
it("supports the default roots when no project is configured", async () => {
  api.listProjects.mockResolvedValue([]);
  await mount();
  expect(api.listSkills).toHaveBeenCalledWith({ forceReload: true });
});
it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "renders the failure and recovery without untranslated keys in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    api.listSkills.mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/settings\./);
    await retry();
    expect(toggle()).toBeDefined();
  },
);
