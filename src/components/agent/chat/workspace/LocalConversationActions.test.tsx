import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { useLocalEnvironmentSelection } from "@/hooks/useLocalEnvironmentSelection";
import { localEnvironments } from "@/lib/api/localEnvironments";
import type { ProjectGitStatus } from "@/lib/api/projectGit";
import { LocalConversationActions } from "./LocalConversationActions";

vi.mock("@/hooks/useLocalEnvironmentSelection", () => ({
  useLocalEnvironmentSelection: vi.fn(),
}));
vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: { readConfig: vi.fn() },
}));
const configPath = "/tree/.codex/environments/environment.toml";
const config = {
  configPath,
  exists: true,
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
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  );
  await changeLimeLocale("en-US");
  run = vi.fn();
  navigate = vi.fn();
  reload = vi.fn();
  vi.mocked(useLocalEnvironmentSelection).mockReturnValue({
    resolvedConfigPath: "/source-only.toml",
    repairConfigPath: null,
    isLoading: false,
    error: false,
    reload,
  } as unknown as ReturnType<typeof useLocalEnvironmentSelection>);
  vi.mocked(localEnvironments.readConfig).mockResolvedValue(config);
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

describe("local conversation actions current configuration consumer", () => {
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
    ).find((item) => item.textContent === "Configure actions…")!;
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
