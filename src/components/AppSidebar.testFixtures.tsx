import "@/test/cloudAccountFixture";
/* eslint-disable react-refresh/only-export-components */
import React from "react";
import {
  buildHomeAgentParams,
  type StartNewConversation,
} from "@/lib/workspace/navigation";
import { act as reactAct } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StyleSheetManager } from "styled-components";
import { createTestStyleSheet } from "@/test/createTestStyleSheet";
import { vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs as LimeSettingsTabs } from "@/types/settings";
import { AppSidebar as AppSidebarComponent } from "./AppSidebar";
import { AppShell, AppShellHeader } from "./app-shell/AppShell";
import { shouldReserveMacWindowControls } from "@/lib/windowControls";
import { changeLimeLocale as changeLimeLocaleImpl } from "@/i18n/createI18n";
import { LIME_COLOR_SCHEME_STORAGE_KEY as LIME_COLOR_SCHEME_STORAGE_KEY_VALUE } from "@/lib/appearance/colorSchemes";
import { LIME_THEME_STORAGE_KEY as LIME_THEME_STORAGE_KEY_VALUE } from "@/lib/appearance/themeMode";
import {
  getCloudAccount as getCloudAccountImpl,
  setOemCloudBootstrapSnapshot as setOemCloudBootstrapSnapshotImpl,
} from "@/lib/cloudAccount";
import type { AgentBackgroundSessionRuntimeSnapshot } from "@/components/agent/chat";

export const act = reactAct;
export const AppSidebar = AppSidebarComponent;
export const mockStartNewConversation = vi.fn<StartNewConversation>();
let newConversationRequestId = 0;

export const changeLimeLocale = changeLimeLocaleImpl;
export const SettingsTabs = LimeSettingsTabs;
export const LIME_COLOR_SCHEME_STORAGE_KEY =
  LIME_COLOR_SCHEME_STORAGE_KEY_VALUE;
export const LIME_THEME_STORAGE_KEY = LIME_THEME_STORAGE_KEY_VALUE;
export const getCloudAccount = getCloudAccountImpl;
export const setOemCloudBootstrapSnapshot = setOemCloudBootstrapSnapshotImpl;

const {
  mockListInstalledPluginCatalog,
  mockGetConfig,
  mockSaveConfig,
  mockSubscribeAppConfigChanged,
  mockListRecentThreads,
  mockGetProject,
  mockUpdateProject,
  mockDeleteProject,
  mockEnsureProjectWorkspace,
  mockCreateProjectGitWorktree,
  mockReadLocalEnvironmentSelection,
  mockRevealPathInFinder,
  mockArchiveAgentRuntimeSession,
  mockUnarchiveAgentRuntimeSession,
  mockSetAgentRuntimeThreadName,
  mockListThreadSections,
  mockCreateThreadSection,
  mockUpdateThreadSection,
  mockDeleteThreadSection,
  mockMoveThreadToSection,
  mockDeleteAgentRuntimeSession,
  mockSetI18nLanguage,
  mockScheduleMinimumDelayIdleTask,
  mockGetConfiguredOemCloudTarget,
  mockBuildOemCloudUserCenterUrl,
  mockCreateExternalBrowserOpenTarget,
  mockOpenExternalUrl,
  mockStartOemCloudLogin,
  mockToastSuccess,
  mockToastError,
  mockToastInfo,
  mockRecordAgentUiPerformanceMetric,
  mockSubscribeAgentUiPerformanceMetricRecorded,
  mockAgentUiPerformanceMetricListeners,
  mockCheckForUpdates,
  mockGetUpdateInstallSession,
  mockListenUpdateInstallSession,
  mockOpenUpdateWindow,
  mockRecordUpdateNotificationAction,
  mockRemindUpdateLater,
  mockStartUpdateInstallSession,
} = vi.hoisted(() => ({
  mockListInstalledPluginCatalog: vi.fn(),
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockSubscribeAppConfigChanged: vi.fn(),
  mockListRecentThreads: vi.fn(),
  mockGetProject: vi.fn(),
  mockUpdateProject: vi.fn(),
  mockDeleteProject: vi.fn(),
  mockEnsureProjectWorkspace: vi.fn(),
  mockCreateProjectGitWorktree: vi.fn(),
  mockReadLocalEnvironmentSelection: vi.fn(),
  mockRevealPathInFinder: vi.fn(),
  mockArchiveAgentRuntimeSession: vi.fn(),
  mockUnarchiveAgentRuntimeSession: vi.fn(),
  mockSetAgentRuntimeThreadName: vi.fn(),
  mockListThreadSections: vi.fn(),
  mockCreateThreadSection: vi.fn(),
  mockUpdateThreadSection: vi.fn(),
  mockDeleteThreadSection: vi.fn(),
  mockMoveThreadToSection: vi.fn(),
  mockDeleteAgentRuntimeSession: vi.fn(),
  mockSetI18nLanguage: vi.fn(),
  mockScheduleMinimumDelayIdleTask: vi.fn((task: () => void) => {
    task();
    return () => undefined;
  }),
  mockGetConfiguredOemCloudTarget: vi.fn(),
  mockBuildOemCloudUserCenterUrl: vi.fn(
    (baseUrl: string, path = "") => `${baseUrl}${path}`,
  ),
  mockCreateExternalBrowserOpenTarget: vi.fn(() => null),
  mockOpenExternalUrl: vi.fn(),
  mockStartOemCloudLogin: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockRecordAgentUiPerformanceMetric: vi.fn(),
  mockSubscribeAgentUiPerformanceMetricRecorded: vi.fn(),
  mockAgentUiPerformanceMetricListeners: [] as Array<
    (detail: {
      id: number;
      phase: string;
      sessionId?: string | null;
      source?: string | null;
      workspaceId?: string | null;
    }) => void
  >,
  mockCheckForUpdates: vi.fn(),
  mockGetUpdateInstallSession: vi.fn(),
  mockListenUpdateInstallSession: vi.fn(),
  mockOpenUpdateWindow: vi.fn(),
  mockRecordUpdateNotificationAction: vi.fn(),
  mockRemindUpdateLater: vi.fn(),
  mockStartUpdateInstallSession: vi.fn(),
}));

function normalizeRecentThreadPage(value: unknown) {
  if (Array.isArray(value)) {
    return { sessions: value, nextCursor: null };
  }
  if (value && typeof value === "object" && "sessions" in value) {
    return value;
  }
  return { sessions: [], nextCursor: null };
}

const originalListRecentThreadsResolvedValue =
  mockListRecentThreads.mockResolvedValue.bind(mockListRecentThreads);
mockListRecentThreads.mockResolvedValue = ((value: unknown) =>
  originalListRecentThreadsResolvedValue(
    normalizeRecentThreadPage(value),
  )) as typeof mockListRecentThreads.mockResolvedValue;

const originalListRecentThreadsResolvedValueOnce =
  mockListRecentThreads.mockResolvedValueOnce.bind(mockListRecentThreads);
mockListRecentThreads.mockResolvedValueOnce = ((value: unknown) =>
  originalListRecentThreadsResolvedValueOnce(
    normalizeRecentThreadPage(value),
  )) as typeof mockListRecentThreads.mockResolvedValueOnce;

const originalListRecentThreadsImplementation =
  mockListRecentThreads.mockImplementation.bind(mockListRecentThreads);
mockListRecentThreads.mockImplementation = ((implementation: unknown) =>
  originalListRecentThreadsImplementation(async (...args: unknown[]) => {
    const result = await (
      implementation as (...implementationArgs: unknown[]) => unknown
    )(...args);
    return normalizeRecentThreadPage(result);
  })) as typeof mockListRecentThreads.mockImplementation;

export {
  mockListInstalledPluginCatalog,
  mockBuildOemCloudUserCenterUrl,
  mockCheckForUpdates,
  mockCreateExternalBrowserOpenTarget,
  mockDeleteAgentRuntimeSession,
  mockGetUpdateInstallSession,
  mockGetConfig,
  mockGetConfiguredOemCloudTarget,
  mockListenUpdateInstallSession,
  mockListRecentThreads,
  mockGetProject,
  mockUpdateProject,
  mockDeleteProject,
  mockEnsureProjectWorkspace,
  mockCreateProjectGitWorktree,
  mockRevealPathInFinder,
  mockOpenExternalUrl,
  mockOpenUpdateWindow,
  mockRecordUpdateNotificationAction,
  mockRecordAgentUiPerformanceMetric,
  mockSubscribeAgentUiPerformanceMetricRecorded,
  mockRemindUpdateLater,
  mockSaveConfig,
  mockScheduleMinimumDelayIdleTask,
  mockSetI18nLanguage,
  mockStartOemCloudLogin,
  mockStartUpdateInstallSession,
  mockSubscribeAppConfigChanged,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
  mockArchiveAgentRuntimeSession,
  mockUnarchiveAgentRuntimeSession,
  mockSetAgentRuntimeThreadName,
  mockListThreadSections,
  mockCreateThreadSection,
  mockUpdateThreadSection,
  mockDeleteThreadSection,
  mockMoveThreadToSection,
};

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
  subscribeAppConfigChanged: mockSubscribeAppConfigChanged,
}));

vi.mock("@/lib/api/pluginCatalog", () => ({
  PLUGIN_CATALOG_CHANGED_EVENT: "lime:plugin-catalog-changed",
  listInstalledPlugins: (...args: unknown[]) =>
    mockListInstalledPluginCatalog(...args),
}));

vi.mock("@/i18n/legacy-patch/I18nPatchProvider", () => ({
  useI18nPatch: () => ({
    language: "zh",
    setLanguage: mockSetI18nLanguage,
  }),
}));

vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  AGENT_RUNTIME_SESSIONS_CHANGED_EVENT: "lime:agent-runtime-sessions-changed",
  archiveAgentRuntimeSession: mockArchiveAgentRuntimeSession,
  deleteAgentRuntimeSession: mockDeleteAgentRuntimeSession,
  listRecentThreads: mockListRecentThreads,
  unarchiveAgentRuntimeSession: mockUnarchiveAgentRuntimeSession,
}));

vi.mock("@/lib/api/agentRuntime/threadClient", () => ({
  setAgentRuntimeThreadName: mockSetAgentRuntimeThreadName,
}));

vi.mock("@/lib/api/threadSections", () => {
  const pinnedSection = {
    id: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
    name: "Pinned",
  };
  return {
    PINNED_THREAD_SECTION: pinnedSection,
    isPinnedThreadSession: (session: { section?: { id?: string } }) =>
      session.section?.id === pinnedSection.id,
    listThreadSections: mockListThreadSections,
    createThreadSection: mockCreateThreadSection,
    updateThreadSection: mockUpdateThreadSection,
    deleteThreadSection: mockDeleteThreadSection,
    moveThreadToSection: mockMoveThreadToSection,
  };
});

vi.mock("@/lib/api/project", () => ({
  getProject: mockGetProject,
  updateProject: mockUpdateProject,
  deleteProject: mockDeleteProject,
  ensureProjectWorkspace: mockEnsureProjectWorkspace,
  extractErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

vi.mock("@/lib/api/projectGit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/projectGit")>()),
  createProjectGitWorktree: mockCreateProjectGitWorktree,
}));

vi.mock("@/lib/api/localEnvironmentSelection", () => ({
  readLocalEnvironmentSelection: mockReadLocalEnvironmentSelection,
}));

vi.mock("@/lib/api/fileSystem", () => ({
  revealPathInFinder: mockRevealPathInFinder,
}));

vi.mock("@/lib/api/appUpdate", () => ({
  checkForUpdates: mockCheckForUpdates,
  getUpdateInstallSession: mockGetUpdateInstallSession,
  listenUpdateInstallSession: mockListenUpdateInstallSession,
  openUpdateWindow: mockOpenUpdateWindow,
  recordUpdateNotificationAction: mockRecordUpdateNotificationAction,
  remindUpdateLater: mockRemindUpdateLater,
  startUpdateInstallSession: mockStartUpdateInstallSession,
  isUpdateInstallSessionActive: (
    session:
      | {
          stage?: string;
          isActive?: boolean;
        }
      | null
      | undefined,
  ) =>
    Boolean(
      session?.isActive &&
      (
        ["checking", "downloading", "installing", "restarting"] as string[]
      ).includes(session.stage ?? ""),
    ),
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  getConfiguredOemCloudTarget: mockGetConfiguredOemCloudTarget,
}));

vi.mock("@/lib/oemCloudLoginLauncher", () => ({
  buildOemCloudUserCenterUrl: mockBuildOemCloudUserCenterUrl,
  createExternalBrowserOpenTarget: mockCreateExternalBrowserOpenTarget,
  openExternalUrl: mockOpenExternalUrl,
  startOemCloudLogin: mockStartOemCloudLogin,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
    info: mockToastInfo,
  },
}));

vi.mock("@/lib/utils/scheduleMinimumDelayIdleTask", () => ({
  scheduleMinimumDelayIdleTask: mockScheduleMinimumDelayIdleTask,
}));

type MockAgentUiPerformanceMetricDetail = {
  id: number;
  phase: string;
  sessionId?: string | null;
  source?: string | null;
  workspaceId?: string | null;
};

export function emitMockAgentUiPerformanceMetricRecorded(
  detail: MockAgentUiPerformanceMetricDetail,
) {
  for (const listener of [...mockAgentUiPerformanceMetricListeners]) {
    listener(detail);
  }
}

vi.mock("@/lib/agentUiPerformanceMetrics", () => ({
  recordAgentUiPerformanceMetric: mockRecordAgentUiPerformanceMetric,
  subscribeAgentUiPerformanceMetricRecorded:
    mockSubscribeAgentUiPerformanceMetricRecorded.mockImplementation(
      (listener: (detail: MockAgentUiPerformanceMetricDetail) => void) => {
        mockAgentUiPerformanceMetricListeners.push(listener);
        return () => {
          const index = mockAgentUiPerformanceMetricListeners.indexOf(listener);
          if (index >= 0) {
            mockAgentUiPerformanceMetricListeners.splice(index, 1);
          }
        };
      },
    ),
}));

interface MountedSidebar {
  container: HTMLDivElement;
  root: Root;
  styleTarget: HTMLDivElement;
}

const mountedSidebars: MountedSidebar[] = [];
export const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = "lime.app-sidebar.collapsed";
export const APP_SIDEBAR_ENABLED_ITEMS_STORAGE_KEY =
  "lime.app-sidebar.enabled-items";

export function mountSidebar(options?: {
  currentPage?: Page;
  currentPageParams?: PageParams;
  activeAgentSessionId?: string | null;
  activeAgentStreaming?: boolean;
  backgroundAgentSessionRuntime?: AgentBackgroundSessionRuntimeSnapshot | null;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  onNavigate?: (page: Page, params?: PageParams) => void;
}): MountedSidebar {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const styleTarget = document.createElement("div");
  document.head.appendChild(styleTarget);
  const sheet = createTestStyleSheet(styleTarget);
  const renderer = createRoot(container);
  const root: Root = {
    render: (children) =>
      renderer.render(
        <StyleSheetManager sheet={sheet}>{children}</StyleSheetManager>,
      ),
    unmount: () => renderer.unmount(),
  };

  act(() => {
    root.render(
      <AppShell>
        <AppShellHeader
          reserveWindowControls={shouldReserveMacWindowControls()}
        />
        <AppSidebar
          currentPage={options?.currentPage ?? "agent"}
          currentPageParams={options?.currentPageParams}
          activeAgentSessionId={options?.activeAgentSessionId}
          activeAgentStreaming={options?.activeAgentStreaming}
          backgroundAgentSessionRuntime={options?.backgroundAgentSessionRuntime}
          requestedPage={options?.requestedPage}
          requestedPageParams={options?.requestedPageParams}
          onNavigate={options?.onNavigate ?? vi.fn()}
          onStartNewConversation={(request) => {
            mockStartNewConversation(request);
            const id = ++newConversationRequestId;
            options?.onNavigate?.(
              "agent",
              buildHomeAgentParams({
                projectId: request.projectId ?? undefined,
                newChatAt: id,
                newConversationRequest: {
                  id,
                  workspaceId: request.projectId,
                  freshDraft: request.freshDraft,
                },
              }),
            );
          }}
        />
      </AppShell>,
    );
  });

  const mounted = { container, root, styleTarget };
  mountedSidebars.push(mounted);
  return mounted;
}

export function mountSidebarContainer(options?: {
  currentPage?: Page;
  currentPageParams?: PageParams;
  activeAgentSessionId?: string | null;
  activeAgentStreaming?: boolean;
  backgroundAgentSessionRuntime?: AgentBackgroundSessionRuntimeSnapshot | null;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  onNavigate?: (page: Page, params?: PageParams) => void;
}) {
  return mountSidebar(options).container;
}

export async function flushEffects(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function openConversationMenu(title: string) {
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-label="打开 ${title} 操作菜单"]`,
      )
      ?.click();
    await Promise.resolve();
  });

  return document.body.querySelector<HTMLElement>(
    '[data-testid="app-sidebar-conversation-menu"]',
  );
}

export async function openProjectMenu(title: string) {
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-label="打开 ${title} 项目菜单"]`,
      )
      ?.click();
    await Promise.resolve();
  });

  return document.body.querySelector<HTMLElement>(
    '[data-testid="app-sidebar-project-menu"]',
  );
}

export async function clickConversationMenuItem(testId: string) {
  await act(async () => {
    document.body
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
      ?.click();
    await Promise.resolve();
  });
}

export async function openAccountMenu(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="app-sidebar-account-button"]',
      )
      ?.click();
    await Promise.resolve();
  });
}

export async function clickAccountMenuItem(
  container: HTMLElement,
  label: string,
) {
  await openAccountMenu(container);

  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?.click();
    await Promise.resolve();
  });
}

export type { AgentPageParams, Page, PageParams };

export async function resetAppSidebarTest() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLimeLocale("zh-CN");
  mockAgentUiPerformanceMetricListeners.splice(
    0,
    mockAgentUiPerformanceMetricListeners.length,
  );
  localStorage.clear();

  delete window.__LIME_OEM_CLOUD__;

  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-lime-theme");
  document.documentElement.removeAttribute("data-lime-color-scheme");
  document.documentElement.removeAttribute("style");
  mockGetConfig.mockResolvedValue({});
  mockListInstalledPluginCatalog.mockResolvedValue({
    marketplaces: [],
  });
  mockSaveConfig.mockResolvedValue(undefined);
  mockListRecentThreads.mockResolvedValue({
    sessions: [],
    nextCursor: null,
  });
  mockGetProject.mockResolvedValue(null);
  mockUpdateProject.mockResolvedValue({});
  mockDeleteProject.mockResolvedValue(true);
  mockEnsureProjectWorkspace.mockResolvedValue({
    id: "project-worktree",
    name: "project-worktree",
    rootPath: "/tmp/project-worktree",
  });
  mockReadLocalEnvironmentSelection.mockResolvedValue(null);
  mockCreateProjectGitWorktree.mockResolvedValue({
    worktreePath: "/tmp/project-worktree",
    branch: "worktree",
    status: {
      rootPath: "/tmp/project",
      hasGitRepository: true,
      currentBranch: "main",
      branches: ["main"],
      uncommittedFileCount: 0,
    },
  });
  mockRevealPathInFinder.mockResolvedValue(undefined);
  mockArchiveAgentRuntimeSession.mockResolvedValue(undefined);
  mockUnarchiveAgentRuntimeSession.mockResolvedValue(undefined);
  mockSetAgentRuntimeThreadName.mockResolvedValue(undefined);
  mockListThreadSections.mockResolvedValue([
    {
      id: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
      name: "Pinned",
    },
  ]);
  mockCreateThreadSection.mockResolvedValue({
    id: "section-created",
    name: "新分组",
  });
  mockUpdateThreadSection.mockImplementation(
    async ({ sectionId, name }: { sectionId: string; name: string }) => ({
      id: sectionId,
      name,
    }),
  );
  mockDeleteThreadSection.mockResolvedValue(undefined);
  mockMoveThreadToSection.mockResolvedValue(undefined);
  mockDeleteAgentRuntimeSession.mockResolvedValue(undefined);
  mockCheckForUpdates.mockResolvedValue({
    current: "1.57.0",
    latest: null,
    hasUpdate: false,
    downloadUrl: null,
    releaseNotesUrl: null,
    releaseNotes: null,
    pubDate: null,
    error: null,
  });
  mockGetUpdateInstallSession.mockResolvedValue({
    sessionId: "idle",
    stage: "idle",
    currentVersion: "1.57.0",
    latestVersion: null,
    downloadUrl: null,
    downloadedBytes: 0,
    totalBytes: null,
    percent: 0,
    message: "idle",
    error: null,
    startedAt: 0,
    updatedAt: 0,
    completedAt: null,
    canCloseWindow: true,
    isActive: false,
  });
  mockListenUpdateInstallSession.mockResolvedValue(() => undefined);
  mockOpenUpdateWindow.mockResolvedValue(undefined);
  mockRecordUpdateNotificationAction.mockResolvedValue(undefined);
  mockRemindUpdateLater.mockResolvedValue(0);
  mockStartUpdateInstallSession.mockResolvedValue({
    sessionId: "installing",
    stage: "downloading",
    currentVersion: "1.57.0",
    latestVersion: "1.58.0",
    downloadUrl: "https://example.com/lime",
    downloadedBytes: 20,
    totalBytes: 100,
    percent: 0.2,
    message: "downloading",
    error: null,
    startedAt: 0,
    updatedAt: 0,
    completedAt: null,
    canCloseWindow: true,
    isActive: true,
  });
  mockGetConfiguredOemCloudTarget.mockReturnValue({
    baseUrl: "https://user.limeai.run",
    tenantId: "tenant-0001",
  });
  mockBuildOemCloudUserCenterUrl.mockImplementation(
    (baseUrl: string, path = "") => `${baseUrl}${path}`,
  );
  mockOpenExternalUrl.mockResolvedValue(undefined);
  mockStartOemCloudLogin.mockResolvedValue({
    mode: "login_url",
    openedUrl: "https://user.limeai.run/login",
  });
  mockScheduleMinimumDelayIdleTask.mockImplementation((task: () => void) => {
    task();
    return () => undefined;
  });
  mockSubscribeAppConfigChanged.mockImplementation((listener: () => void) => {
    (
      globalThis as typeof globalThis & { __appConfigListener?: () => void }
    ).__appConfigListener = listener;
    return () => {
      (
        globalThis as typeof globalThis & {
          __appConfigListener?: () => void;
        }
      ).__appConfigListener = undefined;
    };
  });
}

export function cleanupAppSidebarTest() {
  while (mountedSidebars.length > 0) {
    const mounted = mountedSidebars.pop();
    if (!mounted) {
      continue;
    }

    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted.styleTarget.remove();
  }

  vi.clearAllMocks();
  mockAgentUiPerformanceMetricListeners.splice(
    0,
    mockAgentUiPerformanceMetricListeners.length,
  );
  vi.unstubAllGlobals();

  delete window.__LIME_OEM_CLOUD__;

  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-lime-theme");
  document.documentElement.removeAttribute("data-lime-color-scheme");
  document.documentElement.removeAttribute("style");
  (
    globalThis as typeof globalThis & {
      __appConfigListener?: () => void;
    }
  ).__appConfigListener = undefined;
}
