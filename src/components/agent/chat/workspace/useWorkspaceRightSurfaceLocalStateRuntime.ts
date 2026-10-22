import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  activeSidePanelTab,
  openSidePanelTab,
  closeSidePanelTab,
  selectSidePanelTab,
  pinSidePanelTab,
  type FileSelectionOptions,
  type ThreadSidePanelTabs,
} from "./right-surface/threadSidePanelTabs";
import { openWorkspaceFile } from "./right-surface/openWorkspaceFile";
import { openBackgroundTerminal } from "./right-surface/openBackgroundTerminal";
import { useFileTreePanel } from "./useFileTreePanel";
import type { AgentThreadItem } from "../types";
import type { ThreadSidePanelTab } from "./right-surface/threadSidePanelTabs";
import type { FileEditorDraft } from "./text-file-editor/FileEditorController";
import type { ReviewThreadSidePanelTarget } from "./ReviewThreadSidePanelTab";
import {
  canOpenWorkspaceRightSurface,
  type WorkspaceRightSurfaceKind,
} from "./right-surface";
import type { WorkspaceArticleWorkspace } from "./workspaceArticleWorkspaceModel";
import type { WorkspacePluginSurfaceDescriptor } from "./workspacePluginSurfaceModel";
import type { WorkspaceRightSurfaceBrowserIntent } from "./workspaceRightSurfaceBrowserIntent";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type { BrowserWorkspaceOwner } from "@/lib/api/browserWorkspace";
import { projectWorkspaceBrowserTabs } from "./right-surface/browser/workspaceBrowserTabs";

export interface WorkspaceRightSurfaceOwner {
  workspaceId: string | null;
  sessionId: string | null;
  threadId: string | null;
}

interface RightSurfaceLocalState {
  owner: WorkspaceRightSurfaceOwner;
  sidePanelTabs: ThreadSidePanelTabs;
  activeFilesRightSurfaceTarget: ReviewThreadSidePanelTarget | null;
  activeArticleWorkspace: WorkspaceArticleWorkspace | null;
  rightSurfaceBrowserTitle: string | null;
  activeBrowserRightSurfaceIntent: WorkspaceRightSurfaceBrowserIntent | null;
  activePluginSurfaces: WorkspacePluginSurfaceDescriptor[];
  activePluginSurfaceContainerId: string | null;
  dismissedPluginSurfaceContainerIds: string[];
}

function emptyState(owner: WorkspaceRightSurfaceOwner): RightSurfaceLocalState {
  return {
    owner,
    sidePanelTabs: { tabs: [], activeTabId: null, open: false },
    activeFilesRightSurfaceTarget: null,
    activeArticleWorkspace: null,
    rightSurfaceBrowserTitle: null,
    activeBrowserRightSurfaceIntent: null,
    activePluginSurfaces: [],
    activePluginSurfaceContainerId: null,
    dismissedPluginSurfaceContainerIds: [],
  };
}

function ownerKey(owner: WorkspaceRightSurfaceOwner): string {
  return JSON.stringify([owner.workspaceId, owner.sessionId, owner.threadId]);
}

function stateForOwner(
  current: RightSurfaceLocalState,
  owner: WorkspaceRightSurfaceOwner,
): RightSurfaceLocalState {
  if (ownerKey(current.owner) === ownerKey(owner)) {
    return current;
  }
  const canAdopt =
    current.owner.workspaceId === owner.workspaceId &&
    (!current.owner.sessionId || current.owner.sessionId === owner.sessionId) &&
    (!current.owner.threadId || current.owner.threadId === owner.threadId);
  return canAdopt ? { ...current, owner } : emptyState(owner);
}

function manualSurface(
  current: RightSurfaceLocalState,
): WorkspaceRightSurfaceKind | null {
  return current.sidePanelTabs.open
    ? (activeSidePanelTab(current.sidePanelTabs)?.kind ?? null)
    : null;
}

function openSurface(
  current: RightSurfaceLocalState,
  kind: WorkspaceRightSurfaceKind,
  replaceTabId?: string,
  active = true,
): RightSurfaceLocalState {
  if (!canOpenWorkspaceRightSurface(kind, "user")) return current;
  const existingBrowser =
    kind === "browser"
      ? (current.sidePanelTabs.tabs.find(
          (tab) =>
            tab.kind === "browser" && tab.browser?.tabId ===
            current.activeBrowserRightSurfaceIntent?.tabId,
        ) ?? current.sidePanelTabs.tabs.find((tab) => tab.kind === "browser"))
      : undefined;
  const sidePanelTabs =
    kind === "files"
      ? openWorkspaceFile(current.sidePanelTabs, null, { replaceTabId })
      : openSidePanelTab(
          current.sidePanelTabs,
          existingBrowser ?? { tabId: crypto.randomUUID(), kind },
          replaceTabId,
        );
  return sidePanelTabs === current.sidePanelTabs
    ? current
    : {
        ...current,
        sidePanelTabs: active
          ? sidePanelTabs
          : {
              ...sidePanelTabs,
              activeTabId: current.sidePanelTabs.activeTabId,
              open: current.sidePanelTabs.open,
            },
      };
}

export function useWorkspaceRightSurfaceLocalStateRuntime({
  workspaceId,
  sessionId,
  threadId,
}: WorkspaceRightSurfaceOwner) {
  const owner = useMemo(
    () => ({ workspaceId, sessionId, threadId }),
    [workspaceId, sessionId, threadId],
  );
  const key = ownerKey(owner);
  const ownerRef = useRef({ key, version: 0 });
  if (ownerRef.current.key !== key) {
    ownerRef.current = { key, version: ownerRef.current.version + 1 };
  }
  const version = ownerRef.current.version;
  const fileDrafts = useRef(new WeakMap<ThreadSidePanelTab, FileEditorDraft>());
  const [stored, setStored] = useState(() => emptyState(owner));
  const state = stateForOwner(stored, owner);
  const stateRef = useRef(state);
  stateRef.current = state;
  const emptyFileTab = state.sidePanelTabs.tabs.find(
    (tab) => tab.kind === "files" && !tab.filePath,
  );
  const openedEmptyFileTab = useRef<ThreadSidePanelTab | null>(null);
  const { disabled: fileTreeDisabled, setOpen: setFileTreeOpen } =
    useFileTreePanel();

  useEffect(() => {
    if (!emptyFileTab) {
      openedEmptyFileTab.current = null;
      return;
    }
    if (fileTreeDisabled || openedEmptyFileTab.current === emptyFileTab) return;
    openedEmptyFileTab.current = emptyFileTab;
    void setFileTreeOpen(true);
  }, [emptyFileTab, fileTreeDisabled, setFileTreeOpen]);

  useEffect(() => {
    setStored((current) => stateForOwner(current, owner));
  }, [owner]);

  const actions = useMemo(() => {
    const update = (
      transform: (current: RightSurfaceLocalState) => RightSurfaceLocalState,
    ) => {
      if (ownerRef.current.version !== version) {
        return;
      }
      setStored((current) =>
        ownerRef.current.version === version
          ? transform(stateForOwner(current, owner))
          : current,
      );
    };
    const setter =
      <K extends Exclude<keyof RightSurfaceLocalState, "owner">>(
        field: K,
      ): Dispatch<SetStateAction<RightSurfaceLocalState[K]>> =>
      (value) => {
        update((current) => {
          const next =
            typeof value === "function"
              ? (
                  value as (
                    previous: RightSurfaceLocalState[K],
                  ) => RightSurfaceLocalState[K]
                )(current[field])
              : value;
          if (current[field] === next) {
            return current;
          }
          return { ...current, [field]: next };
        });
      };
    return {
      getFileDraft: (tab: ThreadSidePanelTab): FileEditorDraft | null =>
        ownerRef.current.version === version &&
        stateRef.current.sidePanelTabs.tabs.includes(tab)
          ? (fileDrafts.current.get(tab) ?? null)
          : null,
      setFileDraft: (
        tab: ThreadSidePanelTab,
        draft: FileEditorDraft | null,
      ) => {
        if (
          ownerRef.current.version !== version ||
          tab.kind !== "files" ||
          !stateRef.current.sidePanelTabs.tabs.includes(tab)
        )
          return;
        if (draft) fileDrafts.current.set(tab, draft);
        else fileDrafts.current.delete(tab);
      },
      setActiveArticleWorkspace: setter("activeArticleWorkspace"),
      synchronizeBrowserTabs: (states: readonly BrowserTabState[]) =>
        update((current) => {
          if (states.some((state) => state.threadId !== current.owner.threadId))
            return current;
          const sidePanelTabs = projectWorkspaceBrowserTabs(
            current.sidePanelTabs,
            states,
          );
          return sidePanelTabs === current.sidePanelTabs
            ? current
            : { ...current, sidePanelTabs };
        }),
      setActiveBrowserRightSurfaceIntent: setter(
        "activeBrowserRightSurfaceIntent",
      ),
      setActiveFilesRightSurfaceTarget: setter("activeFilesRightSurfaceTarget"),
      setActivePluginSurfaceContainerId: setter(
        "activePluginSurfaceContainerId",
      ),
      setActivePluginSurfaces: setter("activePluginSurfaces"),
      setDismissedPluginSurfaceContainerIds: setter(
        "dismissedPluginSurfaceContainerIds",
      ),
      setManualRightSurface: (
        value: SetStateAction<WorkspaceRightSurfaceKind | null>,
      ) =>
        update((current) => {
          const next =
            typeof value === "function" ? value(manualSurface(current)) : value;
          return next
            ? openSurface(current, next)
            : {
                ...current,
                sidePanelTabs: { ...current.sidePanelTabs, open: false },
              };
        }),
      canReplaceSidePanelTab: (tabId: string) =>
        ownerRef.current.version === version &&
        stateRef.current.sidePanelTabs.tabs.some(
          (tab) => tab.tabId === tabId && tab.kind === "workspace-new-tab",
        ),
      captureBrowserAddressSource: (sourceTabId: string) => {
        const source = ownerRef.current.version === version ? stateRef.current.sidePanelTabs.tabs.find((tab) =>
          tab.tabId === sourceTabId && tab.kind === "workspace-new-tab")
          : undefined;
        const workspaceId = stateRef.current.owner.workspaceId;
        const initialOwner = stateRef.current.owner;
        const accepts = (current: RightSurfaceLocalState, resolved?: BrowserWorkspaceOwner | null) => {
          if (!source || current.owner.workspaceId !== workspaceId || !current.sidePanelTabs.tabs.includes(source)) return false;
          if (ownerKey(current.owner) === ownerKey(initialOwner)) return true;
          return Boolean(!initialOwner.sessionId && !initialOwner.threadId && resolved &&
            current.owner.sessionId === resolved.runtimeSessionId && current.owner.threadId === resolved.threadId);
        };
        return {
          isCurrent: (resolved?: BrowserWorkspaceOwner | null) => accepts(stateRef.current, resolved),
          replace: (resolved: BrowserWorkspaceOwner, browserTabId: string) => {
            setStored((stored) => {
              const current = stateForOwner(stored, stateRef.current.owner);
              return accepts(current, resolved) ? { ...current,
                sidePanelTabs: openSidePanelTab(current.sidePanelTabs,
                  { tabId: browserTabId, kind: "browser" }, sourceTabId),
              } : stored;
            });
          },
        };
      },
      openSidePanelTab: (
        kind: WorkspaceRightSurfaceKind,
        replaceTabId?: string,
      ) => update((current) => openSurface(current, kind, replaceTabId)),
      openBrowserInBackground: () =>
        update((current) => openSurface(current, "browser", undefined, false)),
      openWorkspaceFile: (
        path: string,
        sourceTab?: ThreadSidePanelTab,
        options?: FileSelectionOptions,
      ) =>
        update((current) => {
          const sidePanelTabs = openWorkspaceFile(current.sidePanelTabs, path, {
            ...options,
            sourceTab:
              sourceTab ??
              current.sidePanelTabs.tabs.find(
                (tab) => tab.kind === "files" && !tab.filePath,
              ),
          });
          return sidePanelTabs === current.sidePanelTabs
            ? current
            : { ...current, sidePanelTabs };
        }),
      pinSidePanelTab: (tabId: string) =>
        update((current) => {
          const sidePanelTabs = pinSidePanelTab(current.sidePanelTabs, tabId);
          return sidePanelTabs === current.sidePanelTabs
            ? current
            : { ...current, sidePanelTabs };
        }),
      openBackgroundTerminal: (item: AgentThreadItem) =>
        update((current) => {
          if (item.thread_id !== current.owner.threadId) return current;
          const sidePanelTabs = openBackgroundTerminal(
            current.sidePanelTabs,
            item,
          );
          return sidePanelTabs === current.sidePanelTabs
            ? current
            : { ...current, sidePanelTabs };
        }),
      selectSidePanelTab: (tabId: string) =>
        update((current) => ({
          ...current,
          sidePanelTabs: selectSidePanelTab(current.sidePanelTabs, tabId),
        })),
      closeSidePanelTab: (tabId: string) =>
        update((current) => ({
          ...current,
          sidePanelTabs: closeSidePanelTab(current.sidePanelTabs, tabId),
        })),
      showSidePanel: () =>
        update((current) =>
          current.sidePanelTabs.tabs.length
            ? {
                ...current,
                sidePanelTabs: { ...current.sidePanelTabs, open: true },
              }
            : openSurface(current, "workspace-new-tab"),
        ),

      setRightSurfaceBrowserTitle: setter("rightSurfaceBrowserTitle"),
      rememberRightSurface: (kind: WorkspaceRightSurfaceKind) =>
        update((current) =>
          current.sidePanelTabs.tabs.some((tab) => tab.kind === kind)
            ? current
            : openSurface(current, kind),
        ),
      closeRightSurface: (kind: WorkspaceRightSurfaceKind) =>
        update((current) => {
          const tabs = current.sidePanelTabs.tabs.filter(
            (tab) => tab.kind === kind,
          );
          return {
            ...current,
            sidePanelTabs: tabs.reduce(
              (state, tab) => closeSidePanelTab(state, tab.tabId),
              current.sidePanelTabs,
            ),
          };
        }),
      pruneRightSurfaces: (available: ReadonlySet<WorkspaceRightSurfaceKind>) =>
        update((current) => {
          const removed = current.sidePanelTabs.tabs.filter(
            (tab) => !available.has(tab.kind),
          );
          if (!removed.length) return current;
          return {
            ...current,
            sidePanelTabs: removed.reduce(
              (state, tab) => closeSidePanelTab(state, tab.tabId),
              current.sidePanelTabs,
            ),
          };
        }),
      clearActiveRightSurfaceTargets: () =>
        update((current) => ({
          ...current,
          sidePanelTabs: { ...current.sidePanelTabs, open: false },
          activeFilesRightSurfaceTarget: null,
          activeArticleWorkspace: null,
        })),
      openArticleWorkspaceRightSurface: (
        articleWorkspace: WorkspaceArticleWorkspace,
      ) =>
        update((current) => ({
          ...openSurface(current, "articleWorkspace"),
          activeArticleWorkspace: articleWorkspace,
        })),
    };
  }, [owner, version]);

  return {
    ...state,
    ...actions,
    manualRightSurface: manualSurface(state),
    openedRightSurfaces: [
      ...new Set(state.sidePanelTabs.tabs.map((tab) => tab.kind)),
    ],
  };
}

export type WorkspaceRightSurfaceLocalStateRuntime = ReturnType<
  typeof useWorkspaceRightSurfaceLocalStateRuntime
>;
