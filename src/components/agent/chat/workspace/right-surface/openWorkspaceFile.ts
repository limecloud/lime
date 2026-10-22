import {
  closeSidePanelTab,
  openSidePanelTab,
  pinSidePanelTab,
  type FileSelectionOptions,
  type ThreadSidePanelTab,
  type ThreadSidePanelTabs,
} from "./threadSidePanelTabs";

export const fileTabId = (path: string | null) => `file:${path ?? ""}`;

export function openWorkspaceFile(
  state: ThreadSidePanelTabs,
  path: string | null,
  options: FileSelectionOptions & {
    sourceTab?: ThreadSidePanelTab;
    replaceTabId?: string;
  } = {},
): ThreadSidePanelTabs {
  const { sourceTab, isPreview = false } = options;
  const replaceTabId =
    options.replaceTabId ??
    (sourceTab?.kind === "workspace-new-tab" ? sourceTab.tabId : undefined);
  // 使用内容实例而非可重用的路径 ID，拒绝关闭后迟到的文件选择。
  if (
    sourceTab &&
    ((sourceTab.kind !== "files" && sourceTab.kind !== "workspace-new-tab") ||
      !state.tabs.includes(sourceTab))
  )
    return state;
  if (
    replaceTabId &&
    !state.tabs.some(
      (tab) => tab.tabId === replaceTabId && tab.kind === "workspace-new-tab",
    )
  )
    return state;
  const tabId = fileTabId(path);
  const existing = state.tabs.some((tab) => tab.tabId === tabId);
  const preview = isPreview && path !== null;
  const previousPreview =
    preview && !existing
      ? state.tabs.find((tab) => tab.tabId === state.previewTabId)
      : undefined;
  const base = preview
    ? !existing && state.previewTabId
      ? closeSidePanelTab(state, state.previewTabId)
      : state
    : pinSidePanelTab(state, tabId);
  const contentInstance = crypto.randomUUID();
  const opened = openSidePanelTab(
    base,
    {
      tabId,
      kind: "files",
      filePath: path,
      contentInstance,
      dndId:
        previousPreview?.dndId ??
        previousPreview?.contentInstance ??
        contentInstance,
    },
    replaceTabId,
  );
  if (opened === state) return state;
  const next =
    preview && !existing ? { ...opened, previewTabId: tabId } : opened;
  return sourceTab?.kind === "files" &&
    !sourceTab.filePath &&
    sourceTab.tabId !== tabId
    ? closeSidePanelTab(next, sourceTab.tabId)
    : next;
}
