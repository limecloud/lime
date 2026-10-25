/* eslint-disable react-refresh/only-export-components */
import { stubSuggestionGeometry } from "./Inputbar/components/contextualSuggestions.testFixtures";
// eslint-disable-next-line no-restricted-imports -- 测试夹具注入真实草稿协调器的 bridge 边界。
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  a,
  harness as coordinatorHarness,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";

import { acceptedSubmission } from "../hooks/agentSendResult.testFixtures";

import {
  getComposerEditorText,
  setComposerEditorText,
} from "@/components/input-kit/composerEditor.testUtils";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { EmptyState } from "./EmptyState";

import type { ProjectGitStatus } from "@/lib/api/projectGit";
import type { Skill } from "@/lib/api/skills";

import type {
  InputbarSendHandler,
  InputbarSendPayload,
} from "./Inputbar/inputbarSendPayload";

import { changeLimeLocale } from "@/i18n/createI18n";

const {
  mockGetConfig,
  mockProjectSelector,
  mockReadProjectGitStatus,
  mockCheckoutProjectGitBranch,
  mockCreateProjectGitBranch,
  mockCreateProjectGitWorktree,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(async () => ({})),
  mockProjectSelector: vi.fn(),
  mockReadProjectGitStatus: vi.fn(
    async (): Promise<ProjectGitStatus> => ({
      rootPath: "/workspace/lime",
      repositoryRoot: undefined,
      hasGitRepository: false,
      currentBranch: undefined,
      branches: [],
      uncommittedFileCount: 0,
    }),
  ),
  mockCheckoutProjectGitBranch: vi.fn(async () => ({
    rootPath: "/workspace/lime",
    repositoryRoot: "/workspace/lime",
    hasGitRepository: true,
    currentBranch: "main",
    branches: ["feature/demo", "main"],
    uncommittedFileCount: 0,
  })),
  mockCreateProjectGitBranch: vi.fn(async () => ({
    rootPath: "/workspace/lime",
    repositoryRoot: "/workspace/lime",
    hasGitRepository: true,
    currentBranch: "feature/new",
    branches: ["feature/demo", "feature/new", "main"],
    uncommittedFileCount: 0,
  })),
  mockCreateProjectGitWorktree: vi.fn(async () => ({
    worktreePath: "/workspace/lime-worktree-test",
    branch: "main",
    status: {
      rootPath: "/workspace/lime-worktree-test",
      repositoryRoot: "/workspace/lime",
      hasGitRepository: true,
      currentBranch: "abcdef0",
      branches: ["feature/demo", "main"],
      uncommittedFileCount: 0,
    },
  })),
}));

const mockGetSkillCatalog = vi.hoisted(() =>
  vi.fn(async () => ({
    version: "test",
    tenantId: "tenant-0001",
    syncedAt: "2026-04-30T00:00:00Z",
    groups: [],
    items: [],
    entries: [],
  })),
);

const {
  mockGatewayChannelStatus,
  mockGetBrowserConnectorSettings,
  mockGetChromeBridgeStatus,
} = vi.hoisted(() => ({
  mockGatewayChannelStatus: vi.fn(),
  mockGetBrowserConnectorSettings: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));

vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));

vi.mock("@/lib/api/appConfig", () => ({
  subscribeAppConfigChanged: () => () => {},
  getConfig: mockGetConfig,
}));

vi.mock("@/lib/api/channelsRuntime", () => ({
  gatewayChannelStatus: mockGatewayChannelStatus,
}));

vi.mock("@/lib/api/skillCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/skillCatalog")>();
  return {
    ...actual,
    getSkillCatalog: mockGetSkillCatalog,
    listSkillCatalogSceneEntries: () => [],
    subscribeSkillCatalogChanged: () => () => undefined,
  };
});

vi.mock("@/lib/webview-api", () => ({
  getBrowserConnectorSettings: mockGetBrowserConnectorSettings,
  getChromeBridgeStatus: mockGetChromeBridgeStatus,
}));

vi.mock("@/components/projects/ProjectSelector", () => ({
  ProjectSelector: (props: {
    value: string | null;
    placeholder?: string;
    onChange?: (projectId: string) => void;
  }) => {
    mockProjectSelector(props);
    return (
      <div data-testid="project-selector-stub">
        {props.value ?? props.placeholder ?? "选择项目"}
      </div>
    );
  },
}));

vi.mock("@/lib/api/projectGit", () => ({
  readProjectGitStatus: mockReadProjectGitStatus,
  checkoutProjectGitBranch: mockCheckoutProjectGitBranch,
  createProjectGitBranch: mockCreateProjectGitBranch,
  createProjectGitWorktree: mockCreateProjectGitWorktree,
}));

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="chat-model-selector" />,
}));

vi.mock("../utils/promptContext", () => ({
  appendSelectedText: vi.fn((fullPrompt: string) => fullPrompt),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    ...rest
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    [key: string]: unknown;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  return { Textarea };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({
    children,
    align: _align,
    side: _side,
    sideOffset: _sideOffset,
    onCloseAutoFocus: _onCloseAutoFocus,
    ...rest
  }: {
    children: React.ReactNode;
    align?: string;
    side?: string;
    sideOffset?: number;
    onCloseAutoFocus?: unknown;
    [key: string]: unknown;
  }) => (
    <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const coordinatorInstances: Awaited<ReturnType<typeof coordinatorHarness>>[] =
  [];

async function prepareCoordinator() {
  const h = await coordinatorHarness({ safeInvoke, safeListen });
  coordinatorInstances.push(h);
  await h.coordinator.bindCommitted(a);
  h.controller.setText("EmptyState persistent draft");
  return h;
}

afterEach(async () => {
  for (const h of coordinatorInstances.splice(0)) await h.close();
});

beforeEach(async () => {
  stubSuggestionGeometry();
  await changeLimeLocale("zh-CN");
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetConfig.mockImplementation(async () => ({}));
  mockGatewayChannelStatus.mockResolvedValue({
    status: {
      running_accounts: 0,
    },
  });
  mockGetBrowserConnectorSettings.mockResolvedValue({
    enabled: true,
    system_connectors: [
      {
        connector_type: "chrome",
        available: true,
        authorization_status: "authorized",
      },
    ],
  });
  mockGetChromeBridgeStatus.mockResolvedValue({
    observer_count: 1,
    control_count: 0,
  });
  mockReadProjectGitStatus.mockResolvedValue({
    rootPath: "/workspace/lime",
    repositoryRoot: undefined,
    hasGitRepository: false,
    currentBranch: undefined,
    branches: [],
    uncommittedFileCount: 0,
  });
  mockCheckoutProjectGitBranch.mockResolvedValue({
    rootPath: "/workspace/lime",
    repositoryRoot: "/workspace/lime",
    hasGitRepository: true,
    currentBranch: "main",
    branches: ["feature/demo", "main"],
    uncommittedFileCount: 0,
  });
  mockCreateProjectGitBranch.mockResolvedValue({
    rootPath: "/workspace/lime",
    repositoryRoot: "/workspace/lime",
    hasGitRepository: true,
    currentBranch: "feature/new",
    branches: ["feature/demo", "feature/new", "main"],
    uncommittedFileCount: 0,
  });
  mockCreateProjectGitWorktree.mockResolvedValue({
    worktreePath: "/workspace/lime-worktree-test",
    branch: "main",
    status: {
      rootPath: "/workspace/lime-worktree-test",
      repositoryRoot: "/workspace/lime",
      hasGitRepository: true,
      currentBranch: "abcdef0",
      branches: ["feature/demo", "main"],
      uncommittedFileCount: 0,
    },
  });
  window.localStorage.clear();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function chooseInstalledSkill(container: HTMLElement, skill: Skill) {
  const editor = container.querySelector<HTMLElement>(
    '[data-testid="composer-editor"]',
  )!;
  act(() =>
    setComposerEditorText(
      editor,
      getComposerEditorText(editor) + " @" + skill.name,
    ),
  );
  const item = document.querySelector<HTMLButtonElement>(
    '[data-suggestion-key="skill:' + skill.key + '"]',
  )!;
  expect(item).toBeTruthy();
  await act(async () => item.click());
}

function renderEmptyState(
  props?: Partial<React.ComponentProps<typeof EmptyState>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof EmptyState> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn<InputbarSendHandler>(async () => acceptedSubmission()),
    providerType: "openai",
    setProviderType: vi.fn(),
    model: "gpt-4.1",
    setModel: vi.fn(),
  };

  act(() => {
    root.render(<EmptyState {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

async function flushAsyncEffects(turns = 4): Promise<void> {
  await act(async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve();
    }
  });
}

async function waitForProjectContextSelector(
  container: HTMLElement,
  selector: string,
  turns = 12,
): Promise<Element | null> {
  for (let index = 0; index < turns; index += 1) {
    const element = container.querySelector(selector);
    if (element) {
      return element;
    }
    await flushAsyncEffects(1);
  }
  return container.querySelector(selector);
}

function expectEmptyStateSend(
  onSend: ReturnType<typeof vi.fn>,
  payload: Pick<
    InputbarSendPayload,
    "images" | "textOverride" | "sendOptions"
  > = {},
) {
  const actual = onSend.mock.calls.at(-1)?.[0] as
    | InputbarSendPayload
    | undefined;
  expect(actual).toBeTruthy();
  expect(actual?.images).toEqual(payload.images);
  expect(actual?.textOverride).toEqual(payload.textOverride);
  expect(actual?.composerDraft?.editorDocument?.type).toBe("doc");
  if (actual?.composerSubmission?.text)
    expect(actual.composerSubmission.text).toBe(actual.textOverride);
  else expect(actual?.composerSubmission?.textElements).toEqual([]);
  expect(actual?.sendOptions?.inputRestoreDraft).toEqual({
    ...actual?.composerDraft,
    images: actual?.composerDraft?.attachments,
  });
  if (payload.sendOptions && "asymmetricMatch" in payload.sendOptions) {
    expect(actual?.sendOptions).toEqual(payload.sendOptions);
  } else {
    const { inputRestoreDraft: _actualRestore, ...actualOptions } =
      actual?.sendOptions ?? {};
    const { inputRestoreDraft: expectedRestore, ...expectedOptions } =
      payload.sendOptions ?? {};
    if (expectedRestore)
      expect(actual?.sendOptions?.inputRestoreDraft).toMatchObject(
        expectedRestore,
      );
    expect(actualOptions).toEqual(expectedOptions);
  }
}

function updateFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
  value: string,
) {
  expect(element).toBeTruthy();
  if (!element) {
    return;
  }

  if (element.matches('[data-testid="composer-editor"]')) {
    setComposerEditorText(element, value);
    return;
  }
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
export {
  renderEmptyState,
  flushAsyncEffects,
  mockReadProjectGitStatus,
  mockCheckoutProjectGitBranch,
  mockCreateProjectGitBranch,
  waitForProjectContextSelector,
  updateFieldValue,
  chooseInstalledSkill,
  expectEmptyStateSend,
  mountedRoots,
  prepareCoordinator,
};
export { EmptyState } from "./EmptyState";
