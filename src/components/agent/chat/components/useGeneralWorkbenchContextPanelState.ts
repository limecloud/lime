import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  buildGeneralWorkbenchActiveContextItems,
  buildGeneralWorkbenchOrderedContextItems,
  buildGeneralWorkbenchSearchContextItems,
  resolveGeneralWorkbenchLatestSearchLabel,
  resolveGeneralWorkbenchSelectedSearchResult,
  type GeneralWorkbenchContextItem,
} from "./generalWorkbenchContextData";
import {
  formatGeneralWorkbenchActionErrorMessage,
  resolveGeneralWorkbenchFileNameFromPath,
} from "./generalWorkbenchSidebarShared";

export type GeneralWorkbenchAddTextContextAction = (payload: {
  content: string;
  name?: string;
}) => Promise<void> | void;

export type GeneralWorkbenchAddLinkContextAction = (payload: {
  url: string;
  name?: string;
}) => Promise<void> | void;

export type GeneralWorkbenchAddFileContextAction = (payload: {
  path: string;
  name?: string;
}) => Promise<void> | void;

interface UseGeneralWorkbenchContextPanelStateParams {
  contextItems: GeneralWorkbenchContextItem[];
  contextSearchQuery: string;
  contextSearchLoading: boolean;
  contextSearchBlockedReason?: string | null;
  onAddTextContext?: GeneralWorkbenchAddTextContextAction;
  onAddLinkContext?: GeneralWorkbenchAddLinkContextAction;
  onAddFileContext?: GeneralWorkbenchAddFileContextAction;
}

export interface GeneralWorkbenchContextPanelState {
  activeContextItems: GeneralWorkbenchContextItem[];
  searchContextItems: GeneralWorkbenchContextItem[];
  orderedContextItems: GeneralWorkbenchContextItem[];
  selectedSearchResult: GeneralWorkbenchContextItem | null;
  latestSearchLabel: string;
  searchInputRef: RefObject<HTMLInputElement>;
  isSearchActionDisabled: boolean;
  addContextDialogOpen: boolean;
  addTextDialogOpen: boolean;
  addLinkDialogOpen: boolean;
  contextDraftText: string;
  contextDraftLink: string;
  contextCreateLoading: boolean;
  contextCreateError: string | null;
  contextDropActive: boolean;
  closeAllContextDialogs: () => void;
  openAddContextDialog: () => void;
  handleSelectSearchResult: (contextId: string | null) => void;
  openTextContextDialog: () => void;
  openLinkContextDialog: () => void;
  handleContextDraftTextChange: (value: string) => void;
  handleContextDraftLinkChange: (value: string) => void;
  handleContextDropActiveChange: (active: boolean) => void;
  handleChooseContextFile: () => Promise<void>;
  handleDropContextFile: (event: DragEvent<HTMLDivElement>) => Promise<void>;
  handleSubmitTextContext: () => Promise<void>;
  handleSubmitLinkContext: () => Promise<void>;
}

export function useGeneralWorkbenchContextPanelState({
  contextItems,
  contextSearchQuery,
  contextSearchLoading,
  contextSearchBlockedReason,
  onAddTextContext,
  onAddLinkContext,
  onAddFileContext,
}: UseGeneralWorkbenchContextPanelStateParams): GeneralWorkbenchContextPanelState {
  const [selectedSearchResultId, setSelectedSearchResultId] = useState<
    string | null
  >(null);
  const [addContextDialogOpen, setAddContextDialogOpen] = useState(false);
  const [addTextDialogOpen, setAddTextDialogOpen] = useState(false);
  const [addLinkDialogOpen, setAddLinkDialogOpen] = useState(false);
  const [contextDraftText, setContextDraftText] = useState("");
  const [contextDraftLink, setContextDraftLink] = useState("");
  const [contextCreateLoading, setContextCreateLoading] = useState(false);
  const [contextCreateError, setContextCreateError] = useState<string | null>(
    null,
  );
  const [contextDropActive, setContextDropActive] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const isSearchActionDisabled =
    contextSearchLoading ||
    Boolean(contextSearchBlockedReason) ||
    contextSearchQuery.trim().length === 0;

  const activeContextItems = useMemo(
    () => buildGeneralWorkbenchActiveContextItems(contextItems),
    [contextItems],
  );
  const searchContextItems = useMemo(
    () => buildGeneralWorkbenchSearchContextItems(contextItems),
    [contextItems],
  );
  const orderedContextItems = useMemo(
    () => buildGeneralWorkbenchOrderedContextItems(contextItems),
    [contextItems],
  );

  const latestSearchLabel = useMemo(() => {
    return resolveGeneralWorkbenchLatestSearchLabel(searchContextItems);
  }, [searchContextItems]);

  const selectedSearchResult = useMemo(
    () =>
      resolveGeneralWorkbenchSelectedSearchResult(
        searchContextItems,
        selectedSearchResultId,
      ),
    [searchContextItems, selectedSearchResultId],
  );

  const closeAllContextDialogs = useCallback(() => {
    setAddContextDialogOpen(false);
    setAddTextDialogOpen(false);
    setAddLinkDialogOpen(false);
    setContextDropActive(false);
    setContextCreateError(null);
    setContextDraftText("");
    setContextDraftLink("");
  }, []);

  const openAddContextDialog = useCallback(() => {
    setContextCreateError(null);
    setAddLinkDialogOpen(false);
    setAddTextDialogOpen(false);
    setAddContextDialogOpen(true);
  }, []);

  const handleSelectSearchResult = useCallback((contextId: string | null) => {
    setSelectedSearchResultId(contextId);
  }, []);

  const openTextContextDialog = useCallback(() => {
    setContextCreateError(null);
    setAddContextDialogOpen(false);
    setAddLinkDialogOpen(false);
    setAddTextDialogOpen(true);
  }, []);

  const openLinkContextDialog = useCallback(() => {
    setContextCreateError(null);
    setAddContextDialogOpen(false);
    setAddTextDialogOpen(false);
    setAddLinkDialogOpen(true);
  }, []);

  const handleContextDraftTextChange = useCallback((value: string) => {
    setContextCreateError(null);
    setContextDraftText(value);
  }, []);

  const handleContextDraftLinkChange = useCallback((value: string) => {
    setContextCreateError(null);
    setContextDraftLink(value);
  }, []);

  const handleContextDropActiveChange = useCallback((active: boolean) => {
    setContextDropActive(active);
  }, []);

  const runContextAction = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      setContextCreateLoading(true);
      setContextCreateError(null);
      try {
        await action();
        toast.success(successMessage);
        closeAllContextDialogs();
      } catch (error) {
        const nextError = formatGeneralWorkbenchActionErrorMessage(
          "添加上下文失败",
          error,
        );
        setContextCreateError(nextError);
      } finally {
        setContextCreateLoading(false);
      }
    },
    [closeAllContextDialogs],
  );

  const handleChooseContextFile = useCallback(async () => {
    if (!onAddFileContext) {
      setContextCreateError("当前版本暂不支持上传文件上下文");
      return;
    }

    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
      });
      if (!selected || typeof selected !== "string") {
        return;
      }

      await runContextAction(async () => {
        await onAddFileContext({
          path: selected,
          name: resolveGeneralWorkbenchFileNameFromPath(selected),
        });
      }, "已添加文件上下文");
    } catch (error) {
      const nextError = formatGeneralWorkbenchActionErrorMessage(
        "读取文件失败",
        error,
      );
      setContextCreateError(nextError);
    }
  }, [onAddFileContext, runContextAction]);

  const handleDropContextFile = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setContextDropActive(false);

      const file = event.dataTransfer.files?.[0];
      if (!file) {
        return;
      }

      const fileWithPath = file as File & { path?: string };
      if (fileWithPath.path && onAddFileContext) {
        await runContextAction(async () => {
          await onAddFileContext({
            path: fileWithPath.path || "",
            name: file.name,
          });
        }, "已添加文件上下文");
        return;
      }

      if (!onAddTextContext) {
        setContextCreateError(
          "当前环境无法读取拖拽文件路径，请使用“上传文件”按钮",
        );
        return;
      }

      await runContextAction(async () => {
        const content = await file.text();
        if (!content.trim()) {
          throw new Error("文件内容为空");
        }
        await onAddTextContext({
          content,
          name: file.name,
        });
      }, "已添加文本上下文");
    },
    [onAddFileContext, onAddTextContext, runContextAction],
  );

  const handleSubmitTextContext = useCallback(async () => {
    if (!onAddTextContext) {
      setContextCreateError("当前版本暂不支持输入文本上下文");
      return;
    }
    const normalizedText = contextDraftText.trim();
    if (!normalizedText) {
      setContextCreateError("请输入文本内容");
      return;
    }
    await runContextAction(async () => {
      await onAddTextContext({
        content: normalizedText,
      });
    }, "已添加文本上下文");
  }, [contextDraftText, onAddTextContext, runContextAction]);

  const handleSubmitLinkContext = useCallback(async () => {
    if (!onAddLinkContext) {
      setContextCreateError("当前版本暂不支持网站链接上下文");
      return;
    }
    const normalizedLink = contextDraftLink.trim();
    if (!normalizedLink) {
      setContextCreateError("请输入网站链接");
      return;
    }
    await runContextAction(async () => {
      await onAddLinkContext({
        url: normalizedLink,
      });
    }, "已添加网站链接上下文");
  }, [contextDraftLink, onAddLinkContext, runContextAction]);

  return {
    activeContextItems,
    searchContextItems,
    orderedContextItems,
    selectedSearchResult,
    latestSearchLabel,
    searchInputRef,
    isSearchActionDisabled,
    addContextDialogOpen,
    addTextDialogOpen,
    addLinkDialogOpen,
    contextDraftText,
    contextDraftLink,
    contextCreateLoading,
    contextCreateError,
    contextDropActive,
    closeAllContextDialogs,
    openAddContextDialog,
    handleSelectSearchResult,
    openTextContextDialog,
    openLinkContextDialog,
    handleContextDraftTextChange,
    handleContextDraftLinkChange,
    handleContextDropActiveChange,
    handleChooseContextFile,
    handleDropContextFile,
    handleSubmitTextContext,
    handleSubmitLinkContext,
  };
}
