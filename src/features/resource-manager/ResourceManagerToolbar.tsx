import type { Ref } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid2x2,
  ImageIcon,
  Info,
  Maximize2,
  MessageCircle,
  Minimize2,
  MoreHorizontal,
  Music,
  Minus,
  Moon,
  Plus,
  Printer,
  RotateCcw,
  RotateCw,
  Scan,
  SunMedium,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  IMAGE_RESOURCE_SCALE_STEP,
  type ImageResourceViewControls,
} from "./imageResourceViewControls";
import { getResourceDocumentProfile } from "./resourceDocumentProfiles";
import { ResourcePreviewSearchBar } from "./ResourcePreviewSearchBar";
import type { ResourceManagerNavigationIntentAction } from "./resourceManagerIntents";
import {
  getItemTitle,
  getKindIcon,
  getKindLabel,
} from "./resourceManagerPresentation";
import {
  getResourceFormatLabel,
  getResourcePreviewTarget,
  getResourcePreviewTargetLabel,
} from "./resourceFormatCatalog";
import type { ResourceManagerItem } from "./types";

interface ResourceManagerToolbarProps {
  activeItem: ResourceManagerItem;
  activeIndex: number;
  itemCount: number;
  hasMultipleItems: boolean;
  showResourceList: boolean;
  showInspector: boolean;
  isFullscreen: boolean;
  menuOpen: boolean;
  imageControls: ImageResourceViewControls;
  canCopyLinkFromToolbar: boolean;
  canSearchActivePreview: boolean;
  canLocateSource: boolean;
  canOpenProjectResource: boolean;
  canOpenOrigin: boolean;
  canContinueImageTask: boolean;
  chatLocationActionLabel: string;
  projectResourceActionLabel: string;
  previewSearchQuery: string;
  previewSearchMatchCount: number;
  previewSearchActiveIndex: number;
  previewSearchInputRef: Ref<HTMLInputElement>;
  onPrevious: () => void;
  onNext: () => void;
  onToggleResourceList: () => void;
  onCopyImage: () => Promise<void> | void;
  onCopyLink: () => Promise<void> | void;
  onCopyContent: () => Promise<void> | void;
  onDownload: () => void;
  onRevealPath: () => Promise<void> | void;
  onOpenWithDefaultApp: () => Promise<void> | void;
  onToggleInspector: () => void;
  onToggleFullscreen: () => Promise<void> | void;
  onToggleMenu: () => void;
  onClose: () => Promise<void> | void;
  onPrint: () => void;
  onOpenOrigin: () => Promise<void> | void;
  onWriteNavigationIntent: (
    action: ResourceManagerNavigationIntentAction,
    successMessage: string,
  ) => void;
  onPreviewSearchQueryChange: (query: string) => void;
  onPreviousPreviewSearchMatch: () => void;
  onNextPreviewSearchMatch: () => void;
  markdownViewMode: "preview" | "source";
  dataViewMode: "formatted" | "raw";
  onToggleMarkdownViewMode: () => void;
  onToggleDataViewMode: () => void;
}

const NAV_ICON_BUTTON_CLASSNAME =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950";
const NAV_ICON_BUTTON_ACTIVE_CLASSNAME = "bg-black/5 text-slate-950";
const NAV_TEXT_BUTTON_CLASSNAME =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-slate-600 transition hover:bg-black/5 hover:text-slate-950";
const NAV_DIVIDER_CLASSNAME = "mx-1 h-5 w-px shrink-0 bg-slate-300";
const MENU_ITEM_CLASSNAME =
  "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100";
const STATUS_PILL_CLASSNAME =
  "inline-flex h-8 shrink-0 cursor-default items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 text-xs font-medium text-slate-400";
const FORMAT_PILL_CLASSNAME =
  "inline-flex h-8 shrink-0 cursor-default items-center gap-1.5 rounded-md bg-white/70 px-2.5 text-xs font-medium text-slate-600";

function getCopyButtonLabel(item: ResourceManagerItem): string {
  if (item.kind === "image" && getResourcePreviewTarget(item) === "webview") {
    return "复制图片";
  }
  if (item.kind === "text" || item.kind === "markdown") return "复制内容";
  return "复制路径 / 地址";
}

function renderFormatPill(item: ResourceManagerItem) {
  const formatLabel = getResourceFormatLabel(item);
  if (!formatLabel) return null;

  return (
    <span
      className={FORMAT_PILL_CLASSNAME}
      title={getResourcePreviewTargetLabel(item)}
    >
      {formatLabel}
    </span>
  );
}

function renderLocalFileToolbarActions(params: {
  item: ResourceManagerItem;
  onOpenWithDefaultApp: () => Promise<void> | void;
  onRevealPath: () => Promise<void> | void;
}) {
  if (!params.item.filePath) {
    return <span className={STATUS_PILL_CLASSNAME}>等待本机路径</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void params.onOpenWithDefaultApp()}
        className={NAV_TEXT_BUTTON_CLASSNAME}
        aria-label="系统打开"
        title="系统打开"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        系统打开
      </button>
      <button
        type="button"
        onClick={() => void params.onRevealPath()}
        className={NAV_TEXT_BUTTON_CLASSNAME}
        aria-label="定位文件"
        title="定位文件"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        定位
      </button>
    </>
  );
}

function renderImageNavigationTools(
  item: ResourceManagerItem,
  controls: ImageResourceViewControls,
) {
  const formatPill = renderFormatPill(item);

  return (
    <>
      {formatPill}
      {formatPill ? <div className={NAV_DIVIDER_CLASSNAME} /> : null}
      <button
        type="button"
        onClick={() => controls.zoomBy(-IMAGE_RESOURCE_SCALE_STEP)}
        className={NAV_ICON_BUTTON_CLASSNAME}
        aria-label="缩小图片"
        title="缩小图片"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-14 shrink-0 px-2 text-center text-xs font-medium text-slate-600">
        {Math.round(controls.scale * 100)}%
      </span>
      <button
        type="button"
        onClick={() => controls.zoomBy(IMAGE_RESOURCE_SCALE_STEP)}
        className={NAV_ICON_BUTTON_CLASSNAME}
        aria-label="放大图片"
        title="放大图片"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className={NAV_DIVIDER_CLASSNAME} />
      <button
        type="button"
        onClick={() => controls.rotateBy(-90)}
        className={NAV_ICON_BUTTON_CLASSNAME}
        aria-label="逆时针旋转"
        title="逆时针旋转"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => controls.rotateBy(90)}
        className={NAV_ICON_BUTTON_CLASSNAME}
        aria-label="顺时针旋转"
        title="顺时针旋转"
      >
        <RotateCw className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => controls.resetView()}
        className={NAV_ICON_BUTTON_CLASSNAME}
        aria-label="重置图片视图"
        title="重置图片视图"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => controls.setFlipX((current) => !current)}
        className={cn(
          NAV_ICON_BUTTON_CLASSNAME,
          controls.flipX && NAV_ICON_BUTTON_ACTIVE_CLASSNAME,
        )}
        aria-label="水平翻转"
        title="水平翻转"
      >
        <FlipHorizontal2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => controls.setFlipY((current) => !current)}
        className={cn(
          NAV_ICON_BUTTON_CLASSNAME,
          controls.flipY && NAV_ICON_BUTTON_ACTIVE_CLASSNAME,
        )}
        aria-label="垂直翻转"
        title="垂直翻转"
      >
        <FlipVertical2 className="h-4 w-4" />
      </button>
      <div className={NAV_DIVIDER_CLASSNAME} />
      <button
        type="button"
        onClick={controls.toggleFitMode}
        className={cn(
          NAV_TEXT_BUTTON_CLASSNAME,
          controls.fitMode === "actual" && NAV_ICON_BUTTON_ACTIVE_CLASSNAME,
        )}
        aria-label={controls.fitMode === "fit" ? "切换原图尺寸" : "适应窗口"}
        title={controls.fitMode === "fit" ? "切换原图尺寸" : "适应窗口"}
      >
        {controls.fitMode === "fit" ? (
          <Maximize2 className="h-3.5 w-3.5" />
        ) : (
          <Scan className="h-3.5 w-3.5" />
        )}
        {controls.fitMode === "fit" ? "适应" : "原图"}
      </button>
      <button
        type="button"
        onClick={controls.cycleBackdropMode}
        className={NAV_TEXT_BUTTON_CLASSNAME}
        aria-label="切换图片背景"
        title="切换图片背景"
      >
        {controls.backdropMode === "dark" ? (
          <Moon className="h-3.5 w-3.5" />
        ) : controls.backdropMode === "light" ? (
          <SunMedium className="h-3.5 w-3.5" />
        ) : (
          <Grid2x2 className="h-3.5 w-3.5" />
        )}
        {controls.backdropMode === "dark"
          ? "深色"
          : controls.backdropMode === "light"
            ? "浅色"
            : "网格"}
      </button>
    </>
  );
}

export function ResourceManagerToolbar({
  activeItem,
  activeIndex,
  itemCount,
  hasMultipleItems,
  showResourceList,
  showInspector,
  isFullscreen,
  menuOpen,
  imageControls,
  canCopyLinkFromToolbar,
  canSearchActivePreview,
  canLocateSource,
  canOpenProjectResource,
  canOpenOrigin,
  canContinueImageTask,
  chatLocationActionLabel,
  projectResourceActionLabel,
  previewSearchQuery,
  previewSearchMatchCount,
  previewSearchActiveIndex,
  previewSearchInputRef,
  onPrevious,
  onNext,
  onToggleResourceList,
  onCopyImage,
  onCopyLink,
  onCopyContent,
  onDownload,
  onRevealPath,
  onOpenWithDefaultApp,
  onToggleInspector,
  onToggleFullscreen,
  onToggleMenu,
  onClose,
  onPrint,
  onOpenOrigin,
  onWriteNavigationIntent,
  onPreviewSearchQueryChange,
  onPreviousPreviewSearchMatch,
  onNextPreviewSearchMatch,
  markdownViewMode,
  dataViewMode,
  onToggleMarkdownViewMode,
  onToggleDataViewMode,
}: ResourceManagerToolbarProps) {
  const ActiveIcon = getKindIcon(activeItem.kind);
  const copyButtonLabel = getCopyButtonLabel(activeItem);
  const previewTarget = getResourcePreviewTarget(activeItem);
  const documentProfile =
    activeItem.kind === "office"
      ? getResourceDocumentProfile(activeItem)
      : null;
  const ownsLocalFileActionsInTypeToolbar =
    (activeItem.kind === "image" && previewTarget !== "webview") ||
    activeItem.kind === "pdf" ||
    activeItem.kind === "video" ||
    activeItem.kind === "audio" ||
    (activeItem.kind === "data" && previewTarget !== "data") ||
    activeItem.kind === "office" ||
    activeItem.kind === "archive" ||
    activeItem.kind === "unknown";
  const hasMoreActions = Boolean(
    activeItem.kind === "image" ||
    canLocateSource ||
    canOpenProjectResource ||
    canOpenOrigin ||
    canContinueImageTask,
  );
  const previewSearchToolbar = canSearchActivePreview ? (
    <>
      <div className={NAV_DIVIDER_CLASSNAME} />
      <ResourcePreviewSearchBar
        ref={previewSearchInputRef}
        query={previewSearchQuery}
        matchCount={previewSearchMatchCount}
        activeMatchIndex={
          previewSearchMatchCount > 0 ? previewSearchActiveIndex : 0
        }
        onQueryChange={onPreviewSearchQueryChange}
        onPreviousMatch={onPreviousPreviewSearchMatch}
        onNextMatch={onNextPreviewSearchMatch}
        placeholder={
          activeItem.kind === "data"
            ? "查找数据内容"
            : activeItem.kind === "markdown"
              ? "查找 Markdown"
              : "查找文本内容"
        }
      />
      {activeItem.kind === "markdown" &&
      markdownViewMode === "preview" &&
      previewSearchQuery.trim() ? (
        <span className="shrink-0 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
          源码模式可高亮
        </span>
      ) : null}
    </>
  ) : null;
  const typeToolbar =
    activeItem.kind === "image" && previewTarget === "webview" ? (
      renderImageNavigationTools(activeItem, imageControls)
    ) : activeItem.kind === "image" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <ImageIcon className="h-3.5 w-3.5" />
          图片
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={STATUS_PILL_CLASSNAME}>系统图片预览</span>
      </>
    ) : activeItem.kind === "pdf" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <FileText className="h-3.5 w-3.5 text-rose-500" />
          PDF
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        <button
          type="button"
          onClick={onPrint}
          className={NAV_TEXT_BUTTON_CLASSNAME}
          aria-label="打印"
          title="打印"
        >
          <Printer className="h-3.5 w-3.5" />
          打印
        </button>
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={STATUS_PILL_CLASSNAME}>浏览器 PDF 控件</span>
      </>
    ) : activeItem.kind === "text" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <FileText className="h-3.5 w-3.5" />
          文本
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        <button
          type="button"
          onClick={() => void onCopyContent()}
          className={NAV_TEXT_BUTTON_CLASSNAME}
          aria-label="复制内容"
          title="复制内容"
        >
          <Copy className="h-3.5 w-3.5" />
          复制内容
        </button>
        {previewSearchToolbar}
      </>
    ) : activeItem.kind === "markdown" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <FileText className="h-3.5 w-3.5" />
          Markdown
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        <button
          type="button"
          onClick={onToggleMarkdownViewMode}
          className={cn(
            NAV_TEXT_BUTTON_CLASSNAME,
            markdownViewMode === "source" && NAV_ICON_BUTTON_ACTIVE_CLASSNAME,
          )}
          aria-label={
            markdownViewMode === "preview"
              ? "查看 Markdown 源码"
              : "查看 Markdown 预览"
          }
          title={
            markdownViewMode === "preview"
              ? "查看 Markdown 源码"
              : "查看 Markdown 预览"
          }
        >
          <Code2 className="h-3.5 w-3.5" />
          {markdownViewMode === "preview" ? "源码" : "预览"}
        </button>
        <button
          type="button"
          onClick={() => void onCopyContent()}
          className={NAV_TEXT_BUTTON_CLASSNAME}
          aria-label="复制内容"
          title="复制内容"
        >
          <Copy className="h-3.5 w-3.5" />
          复制内容
        </button>
        {previewSearchToolbar}
      </>
    ) : activeItem.kind === "video" || activeItem.kind === "audio" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          {activeItem.kind === "video" ? (
            <Video className="h-3.5 w-3.5" />
          ) : (
            <Music className="h-3.5 w-3.5" />
          )}
          {activeItem.kind === "video" ? "视频" : "音频"}
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={FORMAT_PILL_CLASSNAME}>
          {getResourcePreviewTargetLabel(activeItem)}
        </span>
        <span className={STATUS_PILL_CLASSNAME}>原生播放控件</span>
      </>
    ) : activeItem.kind === "data" && previewTarget === "data" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <Database className="h-3.5 w-3.5 text-emerald-600" />
          结构化数据预览
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        <button
          type="button"
          onClick={() => void onCopyContent()}
          className={NAV_TEXT_BUTTON_CLASSNAME}
          aria-label="复制数据内容"
          title="复制数据内容"
        >
          <Copy className="h-3.5 w-3.5" />
          复制数据
        </button>
        <button
          type="button"
          onClick={onToggleDataViewMode}
          className={cn(
            NAV_TEXT_BUTTON_CLASSNAME,
            dataViewMode === "raw" && NAV_ICON_BUTTON_ACTIVE_CLASSNAME,
          )}
          aria-label={
            dataViewMode === "formatted" ? "查看原始数据" : "查看格式化数据"
          }
          title={
            dataViewMode === "formatted" ? "查看原始数据" : "查看格式化数据"
          }
        >
          <Code2 className="h-3.5 w-3.5" />
          {dataViewMode === "formatted" ? "原始" : "格式化"}
        </button>
        {previewSearchToolbar}
      </>
    ) : activeItem.kind === "data" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <Database className="h-3.5 w-3.5 text-emerald-600" />
          数据文件
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={STATUS_PILL_CLASSNAME}>需要专用解析器</span>
      </>
    ) : activeItem.kind === "office" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          {documentProfile ? (
            <documentProfile.Icon
              className={cn("h-3.5 w-3.5", documentProfile.iconClassName)}
            />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5 text-sky-600" />
          )}
          {documentProfile?.toolbarLabel ?? "Office"}
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={STATUS_PILL_CLASSNAME}>
          {documentProfile?.statusLabel ?? "系统文档处理"}
        </span>
      </>
    ) : activeItem.kind === "archive" ? (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <FileArchive className="h-3.5 w-3.5 text-amber-600" />
          压缩包
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={STATUS_PILL_CLASSNAME}>系统解压处理</span>
      </>
    ) : (
      <>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600">
          <FileQuestion className="h-3.5 w-3.5" />
          未知资源
        </span>
        {renderFormatPill(activeItem)}
        <div className={NAV_DIVIDER_CLASSNAME} />
        {renderLocalFileToolbarActions({
          item: activeItem,
          onOpenWithDefaultApp,
          onRevealPath,
        })}
        <span className={STATUS_PILL_CLASSNAME}>系统处理</span>
      </>
    );

  return (
    <header className="flex min-h-[42px] items-center justify-between gap-4 border-b border-[#d9d9db] bg-[#ececee] px-3 py-1 shadow-sm shadow-slate-950/5">
      <div className="flex min-w-0 flex-[1_1_30%] items-center gap-1">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!hasMultipleItems}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="上一项"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMultipleItems}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="下一项"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-slate-300" />
        <button
          type="button"
          onClick={onToggleResourceList}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-black/5",
            showResourceList
              ? "text-[#13c95b]"
              : "text-slate-600 hover:text-slate-950",
          )}
          aria-label="切换资源列表"
        >
          <Grid2x2 className="h-4 w-4" />
        </button>
        <div className="ml-2 hidden min-w-0 items-center gap-2 text-xs text-slate-500 md:flex">
          <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5 text-slate-600">
            <ActiveIcon className="h-3.5 w-3.5" />
            {getKindLabel(activeItem.kind)}
          </span>
          <span className="truncate">{getItemTitle(activeItem)}</span>
          {hasMultipleItems ? (
            <span className="rounded bg-white/70 px-1.5 py-0.5">
              {activeIndex + 1}/{itemCount}
            </span>
          ) : null}
        </div>
      </div>

      <div
        data-testid="resource-manager-type-toolbar"
        className="flex min-w-0 flex-[2_1_auto] items-center justify-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {typeToolbar}
      </div>

      <div className="flex min-w-0 flex-[1_1_30%] shrink-0 items-center justify-end gap-1">
        {activeItem.kind === "image" && previewTarget === "webview" ? (
          <button
            type="button"
            onClick={() => void onCopyImage()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
            aria-label={copyButtonLabel}
            title={copyButtonLabel}
          >
            <Copy className="h-4 w-4" />
          </button>
        ) : canCopyLinkFromToolbar ? (
          <button
            type="button"
            onClick={() => void onCopyLink()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
            aria-label={copyButtonLabel}
            title={copyButtonLabel}
          >
            <Copy className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
          aria-label="下载"
        >
          <Download className="h-4 w-4" />
        </button>
        {activeItem.filePath && !ownsLocalFileActionsInTypeToolbar ? (
          <>
            <button
              type="button"
              onClick={() => void onRevealPath()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
              aria-label="定位文件"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void onOpenWithDefaultApp()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
              aria-label="系统打开"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onToggleInspector}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-black/5",
            showInspector
              ? "text-[#13c95b]"
              : "text-slate-600 hover:text-slate-950",
          )}
          aria-label="切换资源详情"
          title="切换资源详情"
          aria-pressed={showInspector}
        >
          <Info className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void onToggleFullscreen()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
          aria-label={isFullscreen ? "退出全屏" : "全屏"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
        {hasMoreActions ? (
          <div className="relative">
            <button
              type="button"
              onClick={onToggleMenu}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
              aria-label="更多操作"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-50 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-xl shadow-slate-950/15">
                {canLocateSource ? (
                  <button
                    type="button"
                    onClick={() =>
                      onWriteNavigationIntent(
                        "locate_chat",
                        "已记录回跳意图，请回到主窗口继续定位",
                      )
                    }
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <MessageCircle className="h-4 w-4 text-slate-500" />
                    {chatLocationActionLabel}
                  </button>
                ) : null}
                {canOpenProjectResource ? (
                  <button
                    type="button"
                    onClick={() =>
                      onWriteNavigationIntent(
                        "open_project_resource",
                        "已记录项目资源回跳意图",
                      )
                    }
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <FolderOpen className="h-4 w-4 text-slate-500" />
                    {projectResourceActionLabel}
                  </button>
                ) : null}
                {canOpenOrigin ? (
                  <button
                    type="button"
                    onClick={() => void onOpenOrigin()}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <BookOpen className="h-4 w-4 text-slate-500" />
                    阅读原文
                  </button>
                ) : null}
                {canContinueImageTask ? (
                  <button
                    type="button"
                    onClick={() =>
                      onWriteNavigationIntent(
                        "continue_image_task",
                        "已记录后续任务输入意图",
                      )
                    }
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <ImageIcon className="h-4 w-4 text-slate-500" />
                    作为后续任务输入
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void onClose()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-black/5 hover:text-slate-950"
          aria-label="关闭资源管理器"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
