import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { localEnvironments } from "@/lib/api/localEnvironments";
import { selectLocalEnvironment } from "@/lib/api/localEnvironmentSelection";
import { LocalEnvironmentEditor } from "./LocalEnvironmentEditor";
import { toast } from "sonner";

vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: {
    readConfig: vi.fn(),
    saveConfig: vi.fn(),
  },
}));
vi.mock("@/lib/api/localEnvironmentSelection", () => ({
  selectLocalEnvironment: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const configPath = "/project/.codex/environments/environment.toml";
const existing = {
  configPath,
  exists: true,
  revision: "sha256:old",
  raw: "existing",
  environment: {
    type: "success" as const,
    configPath,
    cwdRelativeToGitRoot: ".",
    environment: {
      version: 1,
      name: "Project",
      setup: { script: "npm ci" },
      actions: [],
    },
  },
};
let root: Root, container: HTMLDivElement;
const onBack = vi.fn(),
  onSaved = vi.fn();
const button = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (entry) => entry.textContent === name,
  )!;
const nameInput = () => container.querySelector<HTMLInputElement>("input")!;
async function mount() {
  await act(async () =>
    root.render(
      <LocalEnvironmentEditor
        configPath={configPath}
        defaultName="Project"
        workspaceRoot="/project"
        onBack={onBack}
        onSaved={onSaved}
      />,
    ),
  );
}
async function change(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  vi.mocked(localEnvironments.readConfig).mockResolvedValue(existing);
  vi.mocked(selectLocalEnvironment).mockResolvedValue(true);
  vi.mocked(localEnvironments.saveConfig).mockResolvedValue({
    configPath,
    type: "success",
    revision: "sha256:new",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

describe("LocalEnvironmentEditor", () => {
  it("loads the revision and submits edited scripts once while pending", async () => {
    let complete!: (
      value: Awaited<ReturnType<typeof localEnvironments.saveConfig>>,
    ) => void;
    vi.mocked(localEnvironments.saveConfig).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await mount();
    const script = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Setup script · Default"]',
    )!;
    await change(script, "npm install");
    await click(button("Save"));
    await click(button("Saving…"));
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(1);
    expect(localEnvironments.saveConfig).toHaveBeenCalledWith({
      configPath,
      expectedRevision: "sha256:old",
      raw: expect.stringContaining("npm install"),
    });
    await act(async () =>
      complete({ configPath, type: "success", revision: "sha256:new" }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
  it("keeps the draft on conflict and confirms before reloading it", async () => {
    vi.mocked(localEnvironments.saveConfig).mockResolvedValue({
      configPath,
      type: "conflict",
      revision: "sha256:external",
    });
    await mount();
    await change(nameInput(), "My changes");
    await click(button("Save"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "file changed",
    );
    expect(nameInput().value).toBe("My changes");
    expect(onSaved).not.toHaveBeenCalled();
    await click(button("Reload"));
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(localEnvironments.readConfig).toHaveBeenCalledTimes(1);
  });
  it("creates a configuration using a null revision", async () => {
    vi.mocked(localEnvironments.readConfig).mockResolvedValue({
      configPath,
      exists: false,
      revision: null,
      raw: null,
      environment: null,
    });
    await mount();
    await click(button("Save"));
    expect(localEnvironments.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: null }),
    );
    expect(selectLocalEnvironment).toHaveBeenCalledExactlyOnceWith(
      "/project",
      configPath,
    );
  });
  it.each(["rejected", "disk-error"])(
    "keeps the saved file successful when selecting it returns %s",
    async (failure) => {
      vi.mocked(localEnvironments.readConfig).mockResolvedValue({
        configPath,
        exists: false,
        revision: null,
        raw: null,
        environment: null,
      });
      if (failure === "rejected")
        vi.mocked(selectLocalEnvironment).mockRejectedValue(Error("offline"));
      else vi.mocked(selectLocalEnvironment).mockResolvedValue(false);
      await mount();
      await click(button("Save"));
      expect(localEnvironments.saveConfig).toHaveBeenCalledOnce();
      expect(onSaved).toHaveBeenCalledOnce();
      expect(toast.error).toHaveBeenCalledWith(
        "The environment file was saved, but could not be selected. Select it again from the environment menu.",
      );
      expect(button("Save").disabled).toBe(true);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );
  it("repairs invalid configuration only after explicit save using its original revision", async () => {
    vi.mocked(localEnvironments.readConfig).mockResolvedValue({
      configPath,
      exists: true,
      revision: "sha256:broken",
      raw: "broken",
      environment: {
        type: "error",
        configPath,
        cwdRelativeToGitRoot: ".",
        error: { message: "invalid TOML" },
      },
    });
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid environment",
    );
    expect(nameInput().value).toBe("Project");
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
    await click(button("Save"));
    expect(localEnvironments.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: "sha256:broken" }),
    );
    expect(selectLocalEnvironment).not.toHaveBeenCalled();
  });
  it("ignores a read completed after unmount", async () => {
    let complete!: (value: typeof existing) => void;
    vi.mocked(localEnvironments.readConfig).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await mount();
    await act(async () => root.render(null));
    await act(async () => complete(existing));
    expect(onSaved).not.toHaveBeenCalled();
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "translates controls in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      await mount();
      expect(container.querySelectorAll("textarea")).toHaveLength(2);
      expect(container.textContent).not.toContain(
        "settings.localEnvironments.",
      );
      expect(container.querySelectorAll("h2")).toHaveLength(3);
      expect(
        container.querySelectorAll('button[aria-haspopup="menu"]'),
      ).toHaveLength(2);
    },
  );
});
