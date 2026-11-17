import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { TerminalTab } from "../components/TerminalTab";
import { LocalConversationBackgroundTerminalTab } from "./LocalConversationBackgroundTerminalTab";
import type { AgentThreadItem } from "../types";
import { ExpertInfoPanel } from "../experts/ExpertInfoPanel";
import { GeneralWorkbenchHarnessSurfaceSection } from "./WorkspaceHarnessDialogs";
import { WorkspaceArticleEditorRightSurface } from "./WorkspaceArticleEditorRightSurface";
import { WorkspaceFileThreadSidePanelTab } from "./WorkspaceFileThreadSidePanelTab";
import { ThreadSidePanelNewTab } from "./right-surface/ThreadSidePanelNewTab";
import type { ThreadOutput } from "./right-surface/threadOutputs";
import { resolveOutputPath } from "./right-surface/threadOutputPaths";
import type { ThreadSidePanelAction } from "./right-surface/threadSidePanelActions";
import type {
  FileSelectionOptions,
  ThreadSidePanelTab,
  ThreadSidePanelTabs,
} from "./right-surface/threadSidePanelTabs";
import { ReviewThreadSidePanelTab } from "./ReviewThreadSidePanelTab";
import { WorkspacePluginSurface } from "./WorkspacePluginSurface";
import {
  buildWorkspaceRightSurfaceDefinitions,
  RightSurfaceHost,
  type WorkspaceRightSurfaceKind,
  type WorkspaceRightSurfaceState,
} from "./right-surface";
import { RightSurfaceTabStrip } from "./right-surface/RightSurfaceTabStrip";
import { RightSurfaceBrowserPanel } from "./right-surface/browser/RightSurfaceBrowserPanel";
import { BrowserShortcutRuntime } from "./right-surface/BrowserShortcutRuntime";

type ArticleEditorRightSurfaceProps = ComponentProps<
  typeof WorkspaceArticleEditorRightSurface
>;
type BrowserPanelProps = ComponentProps<typeof RightSurfaceBrowserPanel>;
type ExpertInfoPanelProps = ComponentProps<typeof ExpertInfoPanel>;
type FilesSurfaceProps = ComponentProps<typeof ReviewThreadSidePanelTab>;
type GeneralWorkbenchHarnessSurfaceProps = ComponentProps<
  typeof GeneralWorkbenchHarnessSurfaceSection
>;
type PluginSurfaceProps = ComponentProps<typeof WorkspacePluginSurface>;
type TerminalTabProps = ComponentProps<typeof TerminalTab>;
export interface RenderWorkspaceRightSurfaceHostRuntimeParams {
  idPrefix: string;
  sidePanelTabs: ThreadSidePanelTabs;
  backgroundTerminalItems?: readonly AgentThreadItem[];
  sidePanelActions: readonly ThreadSidePanelAction[];
  outputs?: readonly ThreadOutput[];
  onOpenWebsite: (url: string, event: MouseEvent<HTMLButtonElement>) => void;
  onNewSidePanelTab: () => void;
  onSelectSidePanelTab: (tabId: string) => void;
  onCloseSidePanelTab: (tabId: string) => void;
  onSelectSidePanelAction: (
    kind: WorkspaceRightSurfaceKind,
    replaceTabId?: string,
  ) => void;
  onSelectChatFromNewTab: (tabId: string) => void;
  onOpenWorkspaceFile: (
    path: string,
    sourceTab?: ThreadSidePanelTab,
    options?: FileSelectionOptions,
  ) => void;
  onPinSidePanelTab: (tabId: string) => void;
  activePluginSurfaceContainerId: string | null;
  articleActionsDisabled: boolean;
  articleEditorRightSurface:
    | ArticleEditorRightSurfaceProps["articleWorkspace"]
    | null;
  browserRightSurfaceAvailable: boolean;
  ensureBrowserWorkspaceOwner?: BrowserPanelProps["ensureOwner"];
  browserRightSurfaceInitialUrl?: string | null;
  browserRightSurfaceLaunchTabId?: string | null;
  browserRightSurfaceLaunchRequestId?: string | null;
  onBrowserLaunchApplied?: (requestId: string) => void;
  browserRightSurfaceIntentTitle?: string | null;
  browserRightSurfaceHistoricalProjection?: BrowserPanelProps["historicalProjection"];
  canvasWorkbenchRootPath: TerminalTabProps["cwd"];
  expertInfoPanelProps: ExpertInfoPanelProps;
  filesRightSurfaceAvailable: boolean;
  filesRightSurfaceTarget: FilesSurfaceProps["target"];
  generalWorkbenchHarnessPanelBaseProps: Omit<
    GeneralWorkbenchHarnessSurfaceProps,
    "enabled" | "harnessState"
  >;
  harnessState: GeneralWorkbenchHarnessSurfaceProps["harnessState"];
  pluginSurfaceRightSurface: PluginSurfaceProps["surface"];
  pluginSurfaceRightSurfaces: PluginSurfaceProps["surfaces"];
  preferredServiceSkillResultFileTarget: FilesSurfaceProps["target"];
  rightSurfaceBrowserTitle: string | null;
  rightSurfaceHarnessEnabled: boolean;
  rightSurfaceCloseLabel?: string;
  rightSurfaceMoreLabel?: string;
  rightSurfaceState: WorkspaceRightSurfaceState;
  sceneSessionId?: string | null;
  sceneThreadId?: string | null;
  onArticleActionIntent: ArticleEditorRightSurfaceProps["onActionIntent"];
  onArticleMarkdownChange: ArticleEditorRightSurfaceProps["onArticleMarkdownChange"];
  onArticleSelectedObjectChange: ArticleEditorRightSurfaceProps["onSelectedObjectChange"];
  onClosePluginSurface: PluginSurfaceProps["onCloseSurface"];
  onOpenArticlePreviewArtifact: ArticleEditorRightSurfaceProps["onOpenPreviewArtifact"];
  onOpenServiceSkillResultFile?: FilesSurfaceProps["onOpenResultFile"];
  onRightSurfaceBrowserNavigate: BrowserPanelProps["onNavigate"];
  onSelectPluginSurface: PluginSurfaceProps["onSelectSurface"];
}

export function renderWorkspaceRightSurfaceHostRuntime({
  idPrefix,
  sidePanelTabs,
  backgroundTerminalItems = [],
  sidePanelActions,
  outputs,
  onOpenWebsite,
  onNewSidePanelTab,
  onSelectSidePanelTab,
  onCloseSidePanelTab,
  onSelectSidePanelAction,
  onSelectChatFromNewTab,
  onOpenWorkspaceFile,
  onPinSidePanelTab,
  activePluginSurfaceContainerId,
  articleActionsDisabled,
  articleEditorRightSurface,
  browserRightSurfaceAvailable,
  ensureBrowserWorkspaceOwner,
  browserRightSurfaceInitialUrl,
  browserRightSurfaceLaunchTabId,
  browserRightSurfaceLaunchRequestId,
  onBrowserLaunchApplied,
  browserRightSurfaceIntentTitle,
  browserRightSurfaceHistoricalProjection,
  canvasWorkbenchRootPath,
  expertInfoPanelProps,
  filesRightSurfaceAvailable,
  filesRightSurfaceTarget,
  generalWorkbenchHarnessPanelBaseProps,
  harnessState,
  pluginSurfaceRightSurface,
  pluginSurfaceRightSurfaces,
  preferredServiceSkillResultFileTarget,
  rightSurfaceBrowserTitle,
  rightSurfaceHarnessEnabled,
  rightSurfaceCloseLabel = "Close panel",
  rightSurfaceMoreLabel = "More",
  rightSurfaceState,
  sceneSessionId,
  sceneThreadId,
  onArticleActionIntent,
  onArticleMarkdownChange,
  onArticleSelectedObjectChange,
  onClosePluginSurface,
  onOpenArticlePreviewArtifact,
  onOpenServiceSkillResultFile,
  onRightSurfaceBrowserNavigate,
  onSelectPluginSurface,
}: RenderWorkspaceRightSurfaceHostRuntimeParams): {
  content: ReactNode;
  tabStrip: ReactNode;
  open: boolean;
} {
  const activeTabId = sidePanelTabs.activeTabId;
  const rightSurfaceDefinitions = buildWorkspaceRightSurfaceDefinitions({
    "workspace-new-tab": ({ tab }) => (
      <ThreadSidePanelNewTab
        actions={sidePanelActions}
        onActionSelect={(action) =>
          onSelectSidePanelAction(action.kind, tab.tabId)
        }
        onChatSelect={() => onSelectChatFromNewTab(tab.tabId)}
        outputs={outputs}
        onOpenOutput={(output, event) => {
          if (output.type === "website") {
            if (/^https?:\/\//i.test(output.target)) {
              onOpenWebsite(output.target, event);
            } else {
              onOpenWorkspaceFile(
                resolveOutputPath(
                  output.target,
                  canvasWorkbenchRootPath ?? null,
                ),
              );
            }
            return;
          }
          onOpenWorkspaceFile(output.path, tab);
        }}
      />
    ),

    expertInfo: () => <ExpertInfoPanel {...expertInfoPanelProps} />,
    ...(pluginSurfaceRightSurface
      ? {
          appSurface: () => (
            <WorkspacePluginSurface
              activeContainerId={activePluginSurfaceContainerId}
              runtimeOwner={
                sceneSessionId && sceneThreadId
                  ? { sessionId: sceneSessionId, threadId: sceneThreadId }
                  : null
              }
              surfaces={pluginSurfaceRightSurfaces}
              surface={pluginSurfaceRightSurface}
              onCloseSurface={onClosePluginSurface}
              onSelectSurface={onSelectPluginSurface}
            />
          ),
        }
      : {}),
    ...(articleEditorRightSurface
      ? {
          articleWorkspace: () => (
            <WorkspaceArticleEditorRightSurface
              actionsDisabled={articleActionsDisabled}
              articleWorkspace={articleEditorRightSurface}
              onActionIntent={onArticleActionIntent}
              onArticleMarkdownChange={onArticleMarkdownChange}
              onOpenPreviewArtifact={onOpenArticlePreviewArtifact}
              onSelectedObjectChange={onArticleSelectedObjectChange}
            />
          ),
        }
      : {}),
    ...(filesRightSurfaceAvailable
      ? {
          files: ({ tab }) => (
            <WorkspaceFileThreadSidePanelTab
              tab={tab}
              active={
                sidePanelTabs.open && sidePanelTabs.activeTabId === tab.tabId
              }
              filePath={tab.filePath ?? null}
              onSelectFile={(path, options) =>
                onOpenWorkspaceFile(path, tab, options)
              }
              projectRootPath={canvasWorkbenchRootPath}
            />
          ),
          changes: () => (
            <ReviewThreadSidePanelTab
              target={filesRightSurfaceTarget}
              projectRootPath={canvasWorkbenchRootPath}
              onOpenResultFile={
                preferredServiceSkillResultFileTarget
                  ? onOpenServiceSkillResultFile
                  : undefined
              }
            />
          ),
        }
      : {}),
    ...(browserRightSurfaceAvailable
      ? {
          browser: {
            label:
              rightSurfaceBrowserTitle ??
              browserRightSurfaceIntentTitle ??
              null,
            render: () => (
              <RightSurfaceBrowserPanel
                active={rightSurfaceState.activeSurface === "browser"}
                ensureOwner={ensureBrowserWorkspaceOwner}
                initialUrl={browserRightSurfaceInitialUrl ?? null}
                launchTabId={browserRightSurfaceLaunchTabId}
                launchRequestId={browserRightSurfaceLaunchRequestId}
                onLaunchApplied={onBrowserLaunchApplied}
                runtimeSessionId={sceneSessionId}
                threadId={sceneThreadId || ""}
                onNavigate={onRightSurfaceBrowserNavigate}
                historicalProjection={browserRightSurfaceHistoricalProjection}
              />
            ),
          },
        }
      : {}),
    ...(rightSurfaceHarnessEnabled
      ? {
          harness: () => (
            <GeneralWorkbenchHarnessSurfaceSection
              enabled={rightSurfaceHarnessEnabled}
              harnessState={harnessState}
              {...generalWorkbenchHarnessPanelBaseProps}
            />
          ),
        }
      : {}),
    "background-terminal": ({ tab }) =>
      tab.backgroundTerminal ? (
        <LocalConversationBackgroundTerminalTab
          itemKey={tab.backgroundTerminal}
          items={backgroundTerminalItems}
        />
      ) : null,
    shell: ({ tab }) => (
      <TerminalTab
        cwd={tab.terminalAction?.cwd ?? canvasWorkbenchRootPath}
        command={tab.terminalAction?.command}
        sessionId={tab.tabId}
        active={sidePanelTabs.open && activeTabId === tab.tabId}
        onNewTerminalTab={() => onSelectSidePanelAction("shell")}
      />
    ),
  });
  const hasActiveRightSurfaceDefinition = rightSurfaceDefinitions.some(
    (definition) => definition.kind === rightSurfaceState.activeSurface,
  );

  const activeSurface = rightSurfaceState.activeSurface;
  if (
    (!activeSurface || !hasActiveRightSurfaceDefinition) &&
    !sidePanelTabs.tabs.length
  )
    return { content: null, tabStrip: null, open: false };
  const open = Boolean(activeSurface && hasActiveRightSurfaceDefinition);
  const projectLabel =
    canvasWorkbenchRootPath
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? null;
  return {
    open,
    content: (
      <div className="flex h-full min-h-0 flex-col">
        {projectLabel ? (
          <div
            className="flex h-10 shrink-0 items-center justify-between border-b border-[color:var(--lime-surface-border)] px-3"
            data-testid="right-surface-header"
          >
            <span className="truncate text-xs font-medium text-[color:var(--lime-text-strong)]">
              {projectLabel}
            </span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
                  aria-label={rightSurfaceMoreLabel}
                  data-testid="right-surface-more"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  className="z-[100] min-w-40 rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 shadow-lg"
                >
                  <DropdownMenu.Item
                    className="cursor-pointer rounded-md px-2 py-1.5 text-xs outline-none hover:bg-[color:var(--lime-surface-hover)]"
                    onSelect={() => {
                      if (activeTabId) onCloseSidePanelTab(activeTabId);
                    }}
                  >
                    {rightSurfaceCloseLabel}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
        <BrowserShortcutRuntime
          enabled={activeSurface === "browser"}
          tabId={activeTabId ?? null}
          onNewTab={onNewSidePanelTab}
          onCloseTab={onCloseSidePanelTab}
          onCloseOtherTabs={() => {
            for (const tab of sidePanelTabs.tabs) {
              if (tab.tabId !== activeTabId) onCloseSidePanelTab(tab.tabId);
            }
          }}
          onCloseAllTabs={() => {
            for (const tab of sidePanelTabs.tabs) {
              onCloseSidePanelTab(tab.tabId);
            }
          }}
          onSelectRelativeTab={(offset) => {
            const tabs = sidePanelTabs.tabs;
            if (tabs.length < 2) return;
            const index = tabs.findIndex((tab) => tab.tabId === activeTabId);
            const next = tabs[(index + offset + tabs.length) % tabs.length];
            if (next) onSelectSidePanelTab(next.tabId);
          }}
        />
        <RightSurfaceHost
        activeSurface={activeSurface}
        definitions={rightSurfaceDefinitions}
        idPrefix={idPrefix}
        tabId={activeTabId ?? ""}
        tabs={sidePanelTabs.tabs}
        onPinTab={onPinSidePanelTab}
          previewTabId={sidePanelTabs.previewTabId ?? null}
        />
        </div>
      </div>
    ),
    tabStrip: open ? (
      <RightSurfaceTabStrip
        definitions={rightSurfaceDefinitions}
        tabs={sidePanelTabs.tabs}
        activeTabId={activeTabId}
        onNewTab={onNewSidePanelTab}
        onSelectTab={onSelectSidePanelTab}
        onCloseTab={onCloseSidePanelTab}
        previewTabId={sidePanelTabs.previewTabId ?? null}
        idPrefix={idPrefix}
      />
    ) : null,
  };
}
