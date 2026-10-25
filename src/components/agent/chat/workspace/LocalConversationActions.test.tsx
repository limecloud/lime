import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { useLocalEnvironmentSelection } from "@/hooks/useLocalEnvironmentSelection";
import { useLocalEnvironmentRecentActions } from "@/hooks/useLocalEnvironmentRecentActions";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  setProjectGitWorktreeEnvironment,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";
import { LocalConversationActions } from "./LocalConversationActions";

vi.mock("@/hooks/useLocalEnvironmentSelection", () => ({
  useLocalEnvironmentSelection: vi.fn(),
}));
vi.mock("@/hooks/useLocalEnvironmentRecentActions", () => ({
  useLocalEnvironmentRecentActions: vi.fn(),
}));
vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: {
    readConfig: vi.fn(),
    list: vi.fn(),
    saveConfig: vi.fn(),
  },
}));
vi.mock("@/lib/api/projectGit", async (original) => ({
  ...(await original<typeof import("@/lib/api/projectGit")>()),
  setProjectGitWorktreeEnvironment: vi.fn(),
}));
const configPath = "/tree/.lime/environments/environment.toml";
const config = {
  configPath,
  exists: true,
  revision: "sha256:initial",
  environment: {
    type: "success" as const,
    configPath,
    cwdRelativeToGitRoot: "packages/app",
    environment: {
      name: "Dev",
      version: 1,
      setup: { script: "" },
      actions: [
        {
          name: "Test",
          command: "printf 'a b'; exit 7",
          icon: "test" as const,
        },
        {
          name: "Windows only",
          command: "echo win",
          platform: "win32" as const,
        },
      ],
    },
  },
};
const status: ProjectGitStatus = {
  rootPath: "/tree/sub",
  repositoryRoot: "/tree",
  hasGitRepository: true,
  isWorktree: true,
  localEnvironmentConfigPath: configPath,
  branches: [],
  uncommittedFileCount: 0,
};
let root: Root, container: HTMLDivElement;
const previousScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);
let run: ReturnType<typeof vi.fn>,
  navigate: ReturnType<typeof vi.fn>,
  reload: ReturnType<typeof vi.fn>;
const primary = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="local-conversation-primary-action"]',
  );
async function render(
  next: ProjectGitStatus = status,
  workspaceRoot = next.rootPath,
  failed = false,
) {
  await act(async () =>
    root.render(
      <LocalConversationActions
        workspaceRoot={workspaceRoot}
        status={next}
        loading={false}
        failed={failed}
        onRefresh={reload}
        onRunAction={run}
        onConfigureActions={navigate}
      />,
    ),
  );
}
async function open() {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="local-conversation-actions"]',
  )!;
  await act(async () =>
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
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
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  );
  await changeLimeLocale("en-US");
  run = vi.fn();
  navigate = vi.fn();
  reload = vi.fn();
  vi.mocked(useLocalEnvironmentRecentActions).mockReturnValue({
    recentNames: [],
    recordAction: vi.fn().mockResolvedValue(undefined),
    error: false,
  });
  vi.mocked(useLocalEnvironmentSelection).mockReturnValue({
    resolvedConfigPath: "/source-only.toml",
    repairConfigPath: null,
    isLoading: false,
    error: false,
    reload,
  } as unknown as ReturnType<typeof useLocalEnvironmentSelection>);
  vi.mocked(localEnvironments.readConfig).mockResolvedValue(config);
  vi.mocked(localEnvironments.list).mockResolvedValue({
    environments: [config.environment],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", previousScroll);
  else delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("local conversation actions current configuration consumer", () => {
  it("adds an action through the toolbar, refreshes and runs it through the existing terminal callback", async () => {
    vi.mocked(localEnvironments.saveConfig).mockResolvedValue({
      type: "success",
      configPath,
      revision: "sha256:new",
    });
    await render();
    await open();
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          '[data-testid="local-conversation-add-action"]',
        )!
        .click(),
    );
    const modal = document.querySelector<HTMLElement>(
      '[data-testid="local-environment-action-dialog"]',
    )!;
    expect(modal).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(modal.querySelector("input")),
    );
    await change(modal.querySelector("input")!, " Build ");
    await change(modal.querySelector("textarea")!, " echo built ");
    await act(async () =>
      modal
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(localEnvironments.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath,
        expectedRevision: "sha256:initial",
      }),
    );
    expect(run).toHaveBeenCalledExactlyOnceWith({
      title: "Build",
      command: "echo built",
      cwd: "/tree/packages/app",
    });
    expect(
      vi.mocked(useLocalEnvironmentRecentActions).mock.results.at(-1)?.value
        .recordAction,
    ).toHaveBeenCalledWith("Build");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("sets up an unconfigured checkout with create-only CAS and its Git selection owner", async () => {
    const nextPath = "/tree/sub/.lime/environments/environment.toml";
    vi.mocked(localEnvironments.saveConfig).mockResolvedValue({
      type: "success",
      configPath: nextPath,
      revision: "sha256:new",
    });
    vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValue({
      ...status,
      localEnvironmentConfigPath: nextPath,
    });
    await render({ ...status, localEnvironmentConfigPath: null });
    await open();
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          '[data-testid="local-conversation-add-action"]',
        )!
        .click(),
    );
    const modal = document.querySelector<HTMLElement>(
      '[data-testid="local-environment-setup-dialog"]',
    )!;
    expect(modal).not.toBeNull();
    await change(modal.querySelector("textarea")!, "npm ci");
    await act(async () =>
      modal
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(localEnvironments.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: nextPath, expectedRevision: null }),
    );
    expect(setProjectGitWorktreeEnvironment).toHaveBeenCalledExactlyOnceWith(
      status.rootPath,
      nextPath,
    );
    expect(run).toHaveBeenCalledExactlyOnceWith({
      title: "Project setup",
      command: "npm ci",
      cwd: status.rootPath,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  async function openEnvironments() {
    await open();
    const trigger = document.querySelector<HTMLElement>(
      '[data-testid="local-conversation-change-environment"]',
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(
      document.querySelector(
        '[data-testid="local-conversation-environment-menu"]',
      ),
    ).not.toBeNull();
  }

  it("changes linked checkout selection to None and back using the shared environment menu", async () => {
    await render();
    await openEnvironments();
    vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValueOnce({
      ...status,
      localEnvironmentConfigPath: null,
    });
    await act(async () =>
      document
        .querySelector<HTMLElement>('[cmdk-item][data-value="no-environment"]')!
        .click(),
    );
    expect(setProjectGitWorktreeEnvironment).toHaveBeenCalledExactlyOnceWith(
      status.rootPath,
      null,
    );
    expect(primary()).toBeNull();
    expect(
      document.querySelector(
        '[data-testid="local-conversation-environment-menu"]',
      ),
    ).toBeNull();
    await openEnvironments();
    vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValueOnce(status);
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          `[cmdk-item][data-config-path="${configPath}"]`,
        )!
        .click(),
    );
    expect(setProjectGitWorktreeEnvironment).toHaveBeenLastCalledWith(
      status.rootPath,
      configPath,
    );
    expect(primary()?.getAttribute("aria-label")).toBe("Run: Test");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps failed selection open with the confirmed action and retries the same mutation", async () => {
    await render();
    await openEnvironments();
    vi.mocked(setProjectGitWorktreeEnvironment).mockRejectedValueOnce(
      new Error("disk unavailable"),
    );
    await act(async () =>
      document
        .querySelector<HTMLElement>('[cmdk-item][data-value="no-environment"]')!
        .click(),
    );
    expect(
      document.querySelector(
        '[data-testid="local-conversation-environment-menu"] [role="alert"]',
      )?.textContent,
    ).toContain("Could not save");
    expect(primary()?.getAttribute("aria-label")).toBe("Run: Test");
    vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValueOnce({
      ...status,
      localEnvironmentConfigPath: null,
    });
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          '[cmdk-item][data-value="retry-environments"]',
        )!
        .click(),
    );
    expect(setProjectGitWorktreeEnvironment).toHaveBeenCalledTimes(2);
    expect(primary()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the environment search focused when the pointer enters its submenu", async () => {
    await render();
    await openEnvironments();
    const trigger = document.querySelector<HTMLElement>(
      '[data-testid="local-conversation-change-environment"]',
    )!;
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="local-conversation-environment-menu"] input',
    )!;
    const option = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="no-environment"]',
    )!;
    await act(async () => {
      input.focus();
      const event = new MouseEvent("pointerout", {
        bubbles: true,
        relatedTarget: option,
        clientX: 200,
        clientY: 100,
      });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      trigger.dispatchEvent(event);
    });
    expect(document.activeElement).toBe(input);
    expect(input.isConnected).toBe(true);
    vi.mocked(setProjectGitWorktreeEnvironment).mockRejectedValueOnce(
      new Error("invalid environment"),
    );
    await act(async () => option.click());
    expect(
      document.querySelector(
        '[data-testid="local-conversation-environment-menu"] [role="alert"]',
      )?.textContent,
    ).toContain("Could not save");
  });

  it("edits the environment search with horizontal arrows and closes with Escape", async () => {
    await render();
    await openEnvironments();
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="local-conversation-environment-menu"] input',
    )!;
    await act(async () => {
      input.focus();
      for (const key of ["ArrowLeft", "ArrowRight"])
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
    });
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(input.isConnected).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("runs from worktree Git selection with the configured command and repository-relative cwd", async () => {
    await render();
    expect(localEnvironments.readConfig).toHaveBeenCalledWith(configPath);
    expect(useLocalEnvironmentSelection).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(primary()?.getAttribute("aria-label")).toBe("Run: Test");
    await act(async () => primary()!.click());
    expect(run).toHaveBeenCalledWith({
      title: "Test",
      command: "printf 'a b'; exit 7",
      cwd: "/tree/packages/app",
    });
  });
  it("explicit None on a worktree does not read or run a source checkout action", async () => {
    await render({ ...status, localEnvironmentConfigPath: null });
    expect(localEnvironments.readConfig).not.toHaveBeenCalled();
    expect(primary()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it("makes the most recent available action primary without changing its configured command", async () => {
    const recordAction = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useLocalEnvironmentRecentActions).mockReturnValue({
      recentNames: ["Build", "Windows only", "Test"],
      recordAction,
      error: false,
    });
    vi.mocked(localEnvironments.readConfig).mockResolvedValue({
      ...config,
      environment: {
        ...config.environment,
        environment: {
          ...config.environment.environment,
          actions: [
            ...config.environment.environment.actions,
            { name: "Build", command: "echo build", icon: "run" },
          ],
        },
      },
    });
    await render();
    expect(useLocalEnvironmentRecentActions).toHaveBeenLastCalledWith(
      "/tree/packages/app",
    );
    expect(primary()?.getAttribute("aria-label")).toBe("Run: Build");
    await open();
    expect(
      Array.from(
        document.querySelectorAll('[data-testid="local-conversation-action"]'),
      ).map((item) => item.textContent),
    ).toEqual(["Build", "Test"]);
    await act(async () => primary()!.click());
    expect(recordAction).toHaveBeenCalledExactlyOnceWith("Build");
    expect(run).toHaveBeenCalledExactlyOnceWith({
      title: "Build",
      command: "echo build",
      cwd: "/tree/packages/app",
    });
  });
  it("source checkout uses the existing Host selection", async () => {
    await render({
      ...status,
      isWorktree: false,
      localEnvironmentConfigPath: null,
    });
    expect(useLocalEnvironmentSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        selectDefaultEnvironment: true,
      }),
    );
    expect(localEnvironments.readConfig).toHaveBeenCalledWith(
      "/source-only.toml",
    );
  });
  it("ignores late configuration from a previous checkout", async () => {
    let finish!: (value: typeof config) => void;
    vi.mocked(localEnvironments.readConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await render({
      ...status,
      rootPath: "/other",
      repositoryRoot: "/other",
      localEnvironmentConfigPath: null,
    });
    await act(async () => finish(config));
    expect(primary()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it("fails closed when Git or the selected configuration cannot be read", async () => {
    await render(status, status.rootPath, true);
    expect(localEnvironments.readConfig).not.toHaveBeenCalled();
    expect(primary()).toBeNull();
    vi.mocked(localEnvironments.readConfig).mockRejectedValueOnce(
      new Error("unreadable"),
    );
    await render();
    expect(primary()).toBeNull();
  });
  it("opens with the keyboard, filters platform actions and deep-links to the actual selected file", async () => {
    await render();
    await open();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Windows only");
    const configure = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Environment settings")!;
    await act(async () => configure.click());
    expect(navigate).toHaveBeenCalledExactlyOnceWith(configPath);
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    ["zh-CN", "操作", "运行：Test"],
    ["zh-TW", "操作", "執行：Test"],
    ["en-US", "Actions", "Run: Test"],
    ["ja-JP", "アクション", "実行：Test"],
    ["ko-KR", "작업", "실행: Test"],
  ])("has localized accessible actions in %s", async (locale, title, label) => {
    await changeLimeLocale(locale);
    await render();
    expect(
      container
        .querySelector('[data-testid="local-conversation-actions"]')
        ?.getAttribute("aria-label"),
    ).toBe(title);
    expect(primary()?.getAttribute("aria-label")).toBe(label);
  });
});
