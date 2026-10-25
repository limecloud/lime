import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "smol-toml";
import { toast } from "sonner";
import { changeLimeLocale } from "@/i18n/createI18n";
import { localEnvironments } from "@/lib/api/localEnvironments";
import { LocalEnvironmentActionDialog } from "./LocalEnvironmentActionDialog";
import { LocalEnvironmentSetupDialog } from "./LocalEnvironmentSetupDialog";

vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: { readConfig: vi.fn(), saveConfig: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const configPath = "/project/.lime/environments/environment.toml";
const original = {
  version: 3,
  name: "Dev",
  setup: { script: "npm ci", darwin: { script: "brew bundle" } },
  cleanup: { script: "echo clean", win32: { script: "echo windows" } },
  actions: [
    {
      name: "Existing",
      command: "echo old",
      icon: "run" as const,
      platform: "linux" as const,
    },
  ],
};
const config = {
  configPath,
  exists: true,
  revision: "sha256:old",
  environment: {
    type: "success" as const,
    configPath,
    cwdRelativeToGitRoot: ".",
    environment: original,
  },
};
type ReadResult = Awaited<ReturnType<typeof localEnvironments.readConfig>>;
type SaveResult = Awaited<ReturnType<typeof localEnvironments.saveConfig>>;
const success: SaveResult = {
  type: "success",
  configPath,
  revision: "sha256:new",
};
let root: Root, container: HTMLDivElement;
const saved = vi.fn(),
  closed = vi.fn(),
  navigate = vi.fn(),
  select = vi.fn();

function Harness({ kind }: { kind: "action" | "setup" }) {
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const props = {
    configPath,
    workspaceRoot: "/project",
    restoreFocus: () => trigger.current?.focus(),
    onClose: () => {
      closed();
      setOpen(false);
    },
    onSaved: (value: unknown) => {
      saved(value);
      setOpen(false);
    },
  };
  return (
    <>
      <button ref={trigger}>Actions</button>
      {open ? (
        kind === "action" ? (
          <LocalEnvironmentActionDialog
            {...props}
            onOpenSettings={() => {
              setOpen(false);
              navigate();
            }}
          />
        ) : (
          <LocalEnvironmentSetupDialog {...props} selectEnvironment={select} />
        )
      ) : null}
    </>
  );
}
async function mount(kind: "action" | "setup" = "action") {
  await act(async () => root.render(<Harness kind={kind} />));
}
const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) =>
      node.textContent === name || node.getAttribute("aria-label") === name,
  )!;
const dialog = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="local-environment-action-dialog"], [data-testid="local-environment-setup-dialog"]',
  );
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
async function fill(name: string, value: string) {
  const label = Array.from(
    document.querySelectorAll<HTMLLabelElement>("label"),
  ).find((node) => node.textContent === name);
  const input = (
    label
      ? document.getElementById(label.htmlFor)
      : document.querySelector(`[aria-label="${name}"]`)
  ) as HTMLInputElement | HTMLTextAreaElement;
  expect(input, `input: ${name}`).not.toBeNull();
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
async function submit() {
  await act(async () =>
    dialog()!
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function escape() {
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
}
async function actionInput() {
  await fill("Action name", "  Build  ");
  await fill("Command to run", "  npm run build\necho done  ");
}
const rawSave = () =>
  parse(vi.mocked(localEnvironments.saveConfig).mock.calls.at(-1)![0].raw);

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  vi.mocked(localEnvironments.readConfig).mockResolvedValue(config);
  vi.mocked(localEnvironments.saveConfig).mockResolvedValue(success);
  select.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
  vi.restoreAllMocks();
});

describe("toolbar Add action dialog", () => {
  it("closes from the visible close control without saving", async () => {
    await mount();
    await click(button("Close"));
    expect(dialog()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(button("Actions")),
    );
  });
  it("focuses the name, chooses an icon and appends with the fresh revision while retaining the environment", async () => {
    await mount();
    expect(document.activeElement?.id).toBe(
      dialog()!.querySelector("input")!.id,
    );
    expect(dialog()?.className).toContain("w-[379px]");
    expect(dialog()!.querySelector("textarea")!.rows).toBe(8);
    expect(button("Save").disabled).toBe(true);
    await actionInput();
    await act(async () =>
      button("Icon").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    await click(
      document.querySelector<HTMLElement>(
        '[role="menuitem"][aria-label="Test"]',
      )!,
    );
    await submit();
    expect(localEnvironments.readConfig).toHaveBeenCalledExactlyOnceWith(
      configPath,
    );
    expect(localEnvironments.saveConfig).toHaveBeenCalledExactlyOnceWith({
      configPath,
      expectedRevision: "sha256:old",
      raw: expect.any(String),
    });
    expect(rawSave()).toEqual({
      ...original,
      actions: [
        ...original.actions,
        { name: "Build", command: "npm run build\necho done", icon: "test" },
      ],
    });
    expect(saved).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "Build",
        command: "npm run build\necho done",
        icon: "test",
      }),
    );
    expect(dialog()).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(button("Actions")),
    );
  });
  it("keeps Save disabled until a fresh file read finishes", async () => {
    let finish!: (value: ReadResult) => void;
    vi.mocked(localEnvironments.readConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await actionInput();
    await submit();
    expect(button("Save").disabled).toBe(true);
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
    await act(async () => finish({ ...config, revision: "sha256:fresh" }));
    await submit();
    expect(localEnvironments.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: "sha256:fresh" }),
    );
  });
  it.each(["unreadable", "parse-error", "deleted"])(
    "fails closed when the environment is %s",
    async (failure) => {
      if (failure === "unreadable")
        vi.mocked(localEnvironments.readConfig).mockRejectedValueOnce(
          new Error("read failed"),
        );
      else
        vi.mocked(localEnvironments.readConfig).mockResolvedValueOnce(
          failure === "deleted"
            ? { configPath, exists: false }
            : ({
                ...config,
                environment: {
                  type: "error",
                  configPath,
                  errors: [{ line: 1, message: "invalid" }],
                },
              } as ReadResult),
        );
      await mount();
      await actionInput();
      await submit();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Couldn't load",
      );
      expect(button("Save").disabled).toBe(true);
      expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
    },
  );
  it("keeps the action for retry after a save error and does not run before the successful CAS", async () => {
    vi.mocked(localEnvironments.saveConfig).mockRejectedValueOnce(
      new Error("disk unavailable"),
    );
    await mount();
    await actionInput();
    await submit();
    expect(toast.error).toHaveBeenCalledWith(
      "Could not save the action. Try again",
    );
    expect(dialog()).not.toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(dialog()!.querySelector("input")!.value).toBe("  Build  ");
    await submit();
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it("closes on a revision conflict without running or overwriting", async () => {
    vi.mocked(localEnvironments.saveConfig).mockResolvedValueOnce({
      type: "conflict",
      configPath,
      revision: "sha256:external",
    });
    await mount();
    await actionInput();
    await submit();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "This environment changed on disk. Reopen this dialog and try again",
    );
    expect(dialog()).toBeNull();
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(1);
  });
  it("suppresses duplicate saves and ignores completion after the dialog is closed", async () => {
    let finish!: (value: SaveResult) => void;
    vi.mocked(localEnvironments.saveConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await actionInput();
    await submit();
    await submit();
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(1);
    await escape();
    expect(dialog()).toBeNull();
    await act(async () => finish(success));
    expect(saved).not.toHaveBeenCalled();
  });
  it("closes before opening environment settings and restores keyboard focus on Escape", async () => {
    await mount();
    await click(button("Environment settings"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness key="second" kind="action" />));
    await escape();
    expect(dialog()).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(button("Actions")),
    );
  });
  it("uses the project basename when the existing environment has no name", async () => {
    vi.mocked(localEnvironments.readConfig).mockResolvedValueOnce({
      ...config,
      environment: {
        ...config.environment,
        environment: { ...original, name: "" },
      },
    });
    await mount();
    await actionInput();
    await submit();
    expect(rawSave().name).toBe("project");
  });
});

describe("compact project setup dialog", () => {
  it("creates and selects before delivering the setup script, retaining advanced edits", async () => {
    await mount("setup");
    expect(document.activeElement).toBe(dialog()!.querySelector("textarea"));
    expect(localEnvironments.readConfig).not.toHaveBeenCalled();
    expect(button("Set up project").disabled).toBe(true);
    expect(dialog()!.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(
      0,
    );
    expect(dialog()!.querySelector("textarea")!.rows).toBe(6);
    expect(dialog()!.querySelector("textarea")!.placeholder).toBe(
      "For example: npm install",
    );
    expect(document.querySelector("label")?.textContent).not.toBe("Name");
    await fill("Setup script", "npm ci");
    await click(button("Advanced options"));
    await fill("Name", "Custom project");
    await fill("Cleanup script · Default", "echo clean");
    await click(button("Advanced options"));
    await submit();
    expect(localEnvironments.saveConfig).toHaveBeenCalledExactlyOnceWith({
      configPath,
      expectedRevision: null,
      raw: expect.any(String),
    });
    expect(rawSave()).toEqual({
      version: 1,
      name: "Custom project",
      setup: { script: "npm ci" },
      cleanup: { script: "echo clean" },
      actions: [],
    });
    expect(select).toHaveBeenCalledExactlyOnceWith(configPath);
    expect(select.mock.invocationCallOrder[0]).toBeLessThan(
      saved.mock.invocationCallOrder[0],
    );
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ setupScript: "npm ci" }),
    );
    expect(dialog()).toBeNull();
  });
  it("asks before discarding, keeps editing with the original focus, and finally closes", async () => {
    await mount("setup");
    await fill("Setup script", "npm ci");
    const textarea = dialog()!.querySelector("textarea")!;
    await act(async () => textarea.focus());
    await escape();
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("Discard local environment draft?");
    await click(button("Keep editing"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(textarea.value).toBe("npm ci");
    await escape();
    await click(button("Discard"));
    expect(dialog()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
  });
  it("blocks dismissal and duplicate submission until both save and selection finish", async () => {
    let finish!: (value: SaveResult) => void,
      selected!: (value: boolean) => void;
    vi.mocked(localEnvironments.saveConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    select.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          selected = resolve;
        }),
    );
    await mount("setup");
    await fill("Setup script", "npm ci");
    await submit();
    await submit();
    await escape();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(1);
    await act(async () => finish(success));
    await escape();
    expect(dialog()).not.toBeNull();
    expect(saved).not.toHaveBeenCalled();
    await act(async () => selected(true));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
  it("preserves failed saves for retry with the same create-only revision", async () => {
    vi.mocked(localEnvironments.saveConfig).mockRejectedValueOnce(
      new Error("disk full"),
    );
    await mount("setup");
    await fill("Setup script", "npm ci");
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "draft is kept",
    );
    expect(saved).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    await submit();
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(localEnvironments.saveConfig)
        .mock.calls.every(([params]) => params.expectedRevision === null),
    ).toBe(true);
  });
  it("does not overwrite an environment created concurrently", async () => {
    vi.mocked(localEnvironments.saveConfig).mockResolvedValueOnce({
      type: "conflict",
      configPath,
      revision: "sha256:other",
    });
    await mount("setup");
    await fill("Setup script", "npm ci");
    await submit();
    await submit();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "changed on disk",
    );
    expect(localEnvironments.saveConfig).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });
  it("reports selection failure while retaining the successfully saved environment", async () => {
    select.mockResolvedValueOnce(false);
    await mount("setup");
    await fill("Setup script", "npm ci");
    await submit();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("file was saved"),
    );
    expect(saved).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
  it("closes a clean draft with Escape and rejects whitespace-only setup", async () => {
    await mount("setup");
    await fill("Setup script", "  \n");
    await submit();
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness key="clean" kind="setup" />));
    await escape();
    expect(dialog()).toBeNull();
  });
});

it.each([
  ["zh-CN", "添加操作", "设置此项目"],
  ["zh-TW", "新增操作", "設定此專案"],
  ["en-US", "Add action", "Set up this project"],
  ["ja-JP", "アクションを追加", "このプロジェクトをセットアップ"],
  ["ko-KR", "작업 추가", "이 프로젝트 설정"],
])(
  "provides localized accessible titles for both dialogs in %s",
  async (locale, actionTitle, setupTitle) => {
    await changeLimeLocale(locale);
    await mount();
    expect(dialog()!.querySelector("h2")?.textContent).toBe(actionTitle);
    expect(
      document.getElementById(dialog()!.getAttribute("aria-describedby")!)
        ?.textContent,
    ).not.toContain("agentChat.");
    await act(async () =>
      root.render(<Harness key="localized-setup" kind="setup" />),
    );
    expect(dialog()!.querySelector("h2")?.textContent).toBe(setupTitle);
    expect(
      document.getElementById(dialog()!.getAttribute("aria-describedby")!)
        ?.textContent,
    ).not.toContain("agentChat.");
  },
);
