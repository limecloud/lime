import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { DEFAULT_BROWSER_SETTINGS } from "@/lib/api/browserSettings";
import { BrowserUseSettings } from "./index";
import { useBrowserSettings } from "./useBrowserSettings";

const { pickFiles, update, read, saveDesktop } = vi.hoisted(() => ({
  pickFiles: vi.fn(),
  update: vi.fn(),
  read: vi.fn(),
  saveDesktop: vi.fn(),
}));
vi.mock("@/lib/api/filePicker", () => ({ pickFilesFromDialog: pickFiles }));
vi.mock("@/lib/api/browserSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/browserSettings")>()),
  getBrowserSettingsSnapshot: async () => {
    const settings = await read();
    return {
      settings,
      permissionContext: {
        origins: {},
        userPermissions: settings.agent_permissions,
      },
    };
  },
  updateBrowserSetting: update,
}));
vi.mock("@/lib/api/appConfig", () => ({
  subscribeAppConfigChanged: () => () => {},
}));
vi.mock("@/hooks/useDesktopPreferences", () => ({
  useDesktopPreferences: () => ({
    configured: {},
    pending: false,
    error: null,
    save: saveDesktop,
  }),
}));

let container: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function directory(path: string) {
  return [{ fsPath: path, path, label: "Downloads" }];
}

function changeDirectory() {
  return container.querySelector<HTMLButtonElement>(
    "#browser-download-directory button:last-child",
  )!;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  read.mockReset().mockResolvedValue(structuredClone(DEFAULT_BROWSER_SETTINGS));
  update.mockReset().mockImplementation(async (key, value) => {
    const settings = { ...DEFAULT_BROWSER_SETTINGS, [key]: value };
    read.mockResolvedValue(settings);
    return settings;
  });
  pickFiles.mockReset().mockResolvedValue([]);
  saveDesktop.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

it("opens one directory picker for repeated clicks in the same render batch", async () => {
  const pending = deferred<ReturnType<typeof directory>>();
  pickFiles.mockReturnValue(pending.promise);
  await act(async () => root.render(<BrowserUseSettings />));
  await act(async () => {
    changeDirectory().click();
    changeDirectory().click();
  });
  expect(pickFiles).toHaveBeenCalledTimes(1);
  expect(changeDirectory().disabled).toBe(true);
  await act(async () => pending.resolve(directory("C:\\Downloads")));
  expect(update).toHaveBeenCalledExactlyOnceWith(
    "download_directory",
    "C:\\Downloads",
    null,
  );
  expect(changeDirectory().disabled).toBe(false);
});

it("discards a native selection returned after leaving Browser settings", async () => {
  const pending = deferred<ReturnType<typeof directory>>();
  pickFiles.mockReturnValue(pending.promise);
  await act(async () => root.render(<BrowserUseSettings />));
  await act(async () => changeDirectory().click());
  await act(async () => root.render(null));
  await act(async () => pending.resolve(directory("/old/Downloads")));
  expect(update).not.toHaveBeenCalled();
});

it("keeps the reopened page selection when the previous page picker finishes later", async () => {
  const previous = deferred<ReturnType<typeof directory>>();
  pickFiles.mockReturnValueOnce(previous.promise);
  await act(async () => root.render(<BrowserUseSettings />));
  await act(async () => changeDirectory().click());
  await act(async () => root.render(null));
  await act(async () => root.render(<BrowserUseSettings />));
  pickFiles.mockResolvedValueOnce(directory("/current/Downloads"));
  await act(async () => changeDirectory().click());
  await act(async () => previous.resolve(directory("/stale/Downloads")));
  expect(update).toHaveBeenCalledExactlyOnceWith(
    "download_directory",
    "/current/Downloads",
    null,
  );
  expect(
    container.querySelector("#browser-download-directory")?.textContent,
  ).toContain("/current/Downloads");
  expect(container.querySelector("[role=alert]")).toBeNull();
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "releases a failed picker for explicit retry and keeps cancellation non-mutating in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    const pending = deferred<ReturnType<typeof directory>>();
    pickFiles.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<BrowserUseSettings />));
    await act(async () => changeDirectory().click());
    await act(async () => pending.reject(new Error("native picker failed")));
    const alert = container.querySelector("[role=alert]");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).not.toContain("settings.");
    expect(alert!.textContent!.length).toBeGreaterThan(5);
    expect(changeDirectory().disabled).toBe(false);
    await act(async () => changeDirectory().click());
    expect(pickFiles).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")).toBeNull();
  },
);

it("rejects a retained settings save callback once its page has unmounted", async () => {
  let retainedSave!: ReturnType<typeof useBrowserSettings>["save"];
  function Probe() {
    retainedSave = useBrowserSettings().save;
    return null;
  }
  await act(async () => root.render(<Probe />));
  await act(async () => root.render(null));
  let saved: boolean | undefined;
  await act(async () => {
    saved = await retainedSave("download_directory", "/stale/Downloads");
  });
  expect(saved).toBe(false);
  expect(update).not.toHaveBeenCalled();
});
