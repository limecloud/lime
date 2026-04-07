/**
 * @file 图片搜索 Tab
 * @description 使用 Pixabay API 搜索在线图片，参考 turbodesk 排版优化
 * @module components/image-gen/tabs/ImageSearchTab
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  Search,
  Loader2,
  Image as ImageIcon,
  ExternalLink,
  Download,
  ChevronDown,
  Globe,
  ImagePlus,
  FilePlus2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import styled, { keyframes } from "styled-components";
import {
  useImageSearch,
  type AspectRatioFilter,
  type SearchSource,
} from "../hooks/useImageSearch";
import { getActiveContentTarget } from "@/lib/activeContentTarget";
import {
  emitCanvasImageInsertRequest,
  onCanvasImageInsertAck,
  type CanvasImageInsertAck,
  type CanvasImageTargetType,
} from "@/lib/canvasImageInsertBus";
import {
  addCanvasImageInsertHistory,
  getCanvasImageInsertHistory,
  type CanvasImageInsertHistoryEntry,
} from "@/lib/canvasImageInsertHistory";
import { importMaterialFromUrl } from "@/lib/api/materials";
import type { Page, PageParams } from "@/types/page";

export interface ImageSearchTabProps {
  /** 目标项目 ID */
  projectId?: string | null;
  /** 页面跳转 */
  onNavigate?: (page: Page, params?: PageParams) => void;
}

const CANVAS_DISPLAY_NAME: Record<CanvasImageTargetType, string> = {
  auto: "当前画布",
  document: "文档",
  video: "视频",
};

function normalizeCanvasType(
  value: string | null | undefined,
): CanvasImageTargetType {
  if (value === "document" || value === "video") {
    return value;
  }
  if (value === "script") {
    return "video";
  }
  return "document";
}

function mapCanvasTypeToTheme(canvasType: CanvasImageTargetType): string {
  switch (canvasType) {
    case "video":
      return "video";
    case "document":
    case "auto":
    default:
      return "document";
  }
}

function getVisibleInsertHistory(
  projectId?: string | null,
): CanvasImageInsertHistoryEntry[] {
  const history = getCanvasImageInsertHistory();
  const filtered = projectId
    ? history.filter((entry) => entry.projectId === projectId)
    : history;
  return filtered.slice(0, 5);
}

// ==================== Animations ====================

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

// ==================== Styled Components ====================

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: linear-gradient(180deg, hsl(210 40% 98%) 0%, hsl(0 0% 100%) 100%);
`;

const SearchPanel = styled.div`
  position: relative;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid hsl(var(--border) / 0.78);
  border-radius: 24px;
  background: hsl(var(--background) / 0.84);
  box-shadow:
    0 16px 38px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  overflow: visible;
`;

const ComposerRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 148px;
  gap: 10px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const SearchToolsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const PromptArea = styled.textarea`
  width: 100%;
  min-height: 76px;
  max-height: 128px;
  padding: 14px 16px;
  border: 1px solid hsl(var(--border));
  border-radius: 18px;
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(var(--muted) / 0.12)
  );
  color: hsl(var(--foreground));
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  font-family: inherit;
  transition: all 0.2s ease;

  &:focus {
    outline: none;
    border-color: hsl(214 68% 38% / 0.34);
    background: hsl(var(--background));
    box-shadow: 0 0 0 4px hsl(211 100% 96%);
  }

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }
`;

const FiltersRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const RatioDropdown = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 14px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--background) / 0.92);
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;

  &:hover {
    border-color: hsl(214 68% 38% / 0.28);
    background: hsl(var(--background));
  }
`;

const RatioOptions = styled.div<{ $open: boolean }>`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 140px;
  padding: 6px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--popover));
  box-shadow: 0 16px 36px hsl(215 32% 12% / 0.14);
  display: ${({ $open }) => ($open ? "flex" : "none")};
  flex-direction: column;
  gap: 2px;
  backdrop-filter: blur(20px);
`;

const RatioOption = styled.div<{ $active: boolean }>`
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: ${({ $active }) =>
    $active ? "hsl(var(--primary) / 0.12)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--primary))" : "hsl(var(--foreground))"};
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  user-select: none;

  &:hover {
    background: ${({ $active }) =>
      $active ? "hsl(var(--primary) / 0.15)" : "hsl(var(--accent))"};
  }
`;

const SearchButton = styled.button<{ $loading: boolean }>`
  width: 100%;
  min-height: 76px;
  border: 1px solid hsl(215 28% 17% / 0.92);
  border-radius: 18px;
  background: linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%));
  color: hsl(var(--background));
  font-size: 14px;
  font-weight: 700;
  cursor: ${({ $loading }) => ($loading ? "wait" : "pointer")};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.25s ease;
  position: relative;
  overflow: hidden;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 18px 36px hsl(220 40% 12% / 0.18);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      hsl(0 0% 100% / 0.15),
      transparent
    );
    background-size: 200% 100%;
    animation: ${({ $loading }) => ($loading ? shimmer : "none")} 1.5s infinite;
  }
`;

const SourceTabs = styled.div`
  display: flex;
  flex: 1;
  min-width: 280px;
  gap: 4px;
  padding: 4px;
  border: 1px solid hsl(var(--border) / 0.82);
  border-radius: 16px;
  overflow: hidden;
  background: hsl(var(--muted) / 0.18);
`;

const SourceTab = styled.button<{ $active: boolean }>`
  flex: 1;
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid
    ${({ $active }) => ($active ? "hsl(214 68% 38% / 0.18)" : "transparent")};
  border-radius: 12px;
  background: ${({ $active }) =>
    $active
      ? "linear-gradient(180deg, hsl(var(--background)), hsl(203 100% 97%))"
      : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 700 : 600)};
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover {
    color: ${({ $active }) =>
      $active ? "hsl(var(--foreground))" : "hsl(var(--foreground))"};
    background: ${({ $active }) =>
      $active
        ? "linear-gradient(180deg, hsl(var(--background)), hsl(203 100% 97%))"
        : "hsl(var(--background) / 0.72)"};
  }
`;

const ResultsArea = styled.div`
  flex: 1;
  min-height: 0;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--background) / 0.84);
  box-shadow:
    0 18px 42px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  overflow: hidden;
`;

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  padding: 14px 16px 18px;
`;

const ImageCard = styled.div<{ $aspectRatio?: number }>`
  position: relative;
  aspect-ratio: ${({ $aspectRatio }) =>
    $aspectRatio ? Math.max(0.82, Math.min(1.5, $aspectRatio)) : 4 / 3};
  min-height: 180px;
  max-height: 340px;
  border-radius: 20px;
  border: 1px solid hsl(var(--border) / 0.82);
  overflow: hidden;
  cursor: pointer;
  animation: ${fadeIn} 0.35s ease both;
  transition: all 0.25s ease;
  background: hsl(var(--background));
  box-shadow:
    0 14px 34px hsl(215 32% 12% / 0.06),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 20px 44px hsl(215 32% 12% / 0.1);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.4s ease;
  }

  &:hover img {
    transform: scale(1.06);
  }
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 34%,
    hsl(220 40% 12% / 0.78) 100%
  );
  opacity: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding: 16px;
  gap: 8px;
  transition: opacity 0.25s ease;

  ${ImageCard}:hover & {
    opacity: 1;
  }
`;

const OverlayActions = styled.div`
  display: flex;
  gap: 8px;
  width: 100%;
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  flex: 1;
  height: 36px;
  border: ${({ $primary }) =>
    $primary ? "none" : "1px solid hsl(0 0% 100% / 0.2)"};
  border-radius: 12px;
  background: ${({ $primary }) =>
    $primary
      ? "linear-gradient(180deg, hsl(221 39% 18%), hsl(216 34% 14%))"
      : "hsl(0 0% 100% / 0.12)"};
  color: ${({ $primary }) =>
    $primary ? "hsl(var(--background))" : "hsl(var(--background))"};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  backdrop-filter: blur(12px);
  transition: all 0.2s ease;

  &:hover {
    transform: scale(1.03);
    box-shadow: 0 8px 18px hsl(215 32% 12% / 0.22);
  }

  &:disabled {
    opacity: 0.5;
    cursor: wait;
  }
`;

const MetaBadge = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: hsl(var(--background) / 0.84);
  backdrop-filter: blur(8px);
  font-size: 10px;
  color: hsl(var(--foreground) / 0.8);
  opacity: 0;
  transition: opacity 0.2s;

  ${ImageCard}:hover & {
    opacity: 1;
  }
`;

const ProviderBadge = styled.div`
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: hsl(221 39% 16% / 0.92);
  backdrop-filter: blur(8px);
  font-size: 10px;
  color: hsl(var(--background));
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;

  ${ImageCard}:hover & {
    opacity: 1;
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 72px 48px;
  gap: 16px;
  color: hsl(var(--muted-foreground));
  text-align: center;
`;

const EmptyIcon = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: linear-gradient(
    135deg,
    hsl(203 100% 97%),
    hsl(201 52% 94% / 0.86)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(211 58% 38%);
`;

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const EmptyHint = styled.p`
  margin: 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  border-top: 1px solid hsl(var(--border) / 0.42);
`;

const Attribution = styled.a`
  color: hsl(211 58% 38%);
  text-decoration: none;
  font-weight: 600;
  transition: color 0.2s;

  &:hover {
    color: hsl(var(--primary));
    text-decoration: underline;
  }
`;

const LoadMoreButton = styled.button<{ $loading: boolean }>`
  width: calc(100% - 32px);
  margin: 0 16px 16px;
  height: 40px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--background) / 0.9);
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 600;
  cursor: ${({ $loading }) => ($loading ? "wait" : "pointer")};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    border-color: hsl(214 68% 38% / 0.28);
    background: hsl(var(--background));
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
  }
`;

const ResultCount = styled.span`
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  padding: 14px 16px 0;
  display: block;
`;

const RecentInsertPanel = styled.div`
  border: 1px solid hsl(var(--border) / 0.55);
  border-radius: 18px;
  background: hsl(var(--background) / 0.86);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RecentInsertHeader = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
`;

const RecentInsertList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const RecentInsertItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 260px;
  padding: 8px 10px;
  border-radius: 14px;
  border: 1px solid hsl(var(--border) / 0.8);
  background: hsl(var(--background) / 0.88);
`;

const RecentInsertMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RecentInsertTitle = styled.div`
  font-size: 12px;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RecentInsertHint = styled.div`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RelocateButton = styled.button`
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 11px;
  padding: 6px 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;

  &:hover {
    border-color: hsl(214 68% 38% / 0.32);
    color: hsl(211 58% 38%);
  }
`;

// ==================== Constants ====================

const SOURCE_TABS = [
  { key: "web", label: "联网搜索", icon: Globe },
  { key: "pixabay", label: "Pixabay图库", icon: ImagePlus },
] as const;

const SOURCE_HINTS: Record<
  SearchSource,
  {
    resultLabel: string;
    attributionName: string;
    attributionUrl: string;
  }
> = {
  web: {
    resultLabel: "Pexels 图库",
    attributionName: "Pexels",
    attributionUrl: "https://www.pexels.com",
  },
  pixabay: {
    resultLabel: "Pixabay 图库",
    attributionName: "Pixabay",
    attributionUrl: "https://pixabay.com",
  },
};

const RATIO_OPTIONS: Array<{
  value: AspectRatioFilter;
  label: string;
  icon: string;
}> = [
  { value: "all", label: "不限比例", icon: "⬜" },
  { value: "landscape", label: "横向", icon: "▬" },
  { value: "portrait", label: "纵向", icon: "▮" },
  { value: "square", label: "方形", icon: "◻" },
];

// ==================== Component ====================

export function ImageSearchTab({ projectId, onNavigate }: ImageSearchTabProps) {
  const {
    query,
    setQuery,
    aspectRatio,
    setAspectRatio,
    sourceStates,
    search,
    loadMore,
  } = useImageSearch();

  const [savingId, setSavingId] = useState<string | null>(null);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [searchSource, setSearchSource] = useState<SearchSource>("web");
  const pendingInsertRequestMetaRef = useRef<
    Map<
      string,
      {
        projectId: string;
        contentId: string | null;
        canvasType: CanvasImageTargetType;
        theme: string;
        imageTitle?: string;
      }
    >
  >(new Map());
  const [recentInsertHistory, setRecentInsertHistory] = useState<
    CanvasImageInsertHistoryEntry[]
  >(() => getVisibleInsertHistory(projectId));

  const currentState = sourceStates[searchSource];
  const results = currentState.results;
  const loading = currentState.loading;
  const total = currentState.total;
  const error = currentState.error;
  const lastQuery = currentState.lastQuery;
  const hasMore = results.length < total;
  const sourceHint = SOURCE_HINTS[searchSource];

  const currentRatioLabel =
    RATIO_OPTIONS.find((opt) => opt.value === aspectRatio)?.label || "不限比例";

  useEffect(() => {
    setRecentInsertHistory(getVisibleInsertHistory(projectId));
  }, [projectId]);

  useEffect(() => {
    const unsubscribe = onCanvasImageInsertAck((ack: CanvasImageInsertAck) => {
      const pendingMeta = pendingInsertRequestMetaRef.current.get(
        ack.requestId,
      );
      if (!pendingMeta) {
        return;
      }
      pendingInsertRequestMetaRef.current.delete(ack.requestId);

      if (ack.success) {
        const canvasLabel = CANVAS_DISPLAY_NAME[ack.canvasType] || "目标画布";
        const locationLabel = ack.locationLabel
          ? ` · ${ack.locationLabel}`
          : "";
        toast.success(`已插入到${canvasLabel}${locationLabel}`);

        const nextHistory = addCanvasImageInsertHistory({
          requestId: ack.requestId,
          projectId: pendingMeta.projectId,
          contentId: pendingMeta.contentId,
          canvasType: pendingMeta.canvasType,
          theme: pendingMeta.theme,
          imageTitle: pendingMeta.imageTitle,
          locationLabel: ack.locationLabel,
        });
        setRecentInsertHistory(
          (projectId
            ? nextHistory.filter((entry) => entry.projectId === projectId)
            : nextHistory
          ).slice(0, 5),
        );
      } else {
        toast.error("插入失败，请返回创作区重试");
      }
    });

    return unsubscribe;
  }, [projectId]);

  const handleSearch = () => {
    if (!query.trim()) {
      toast.error("请输入搜索关键词");
      return;
    }
    void search(searchSource, query, true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleSaveImage = async (
    imageUrl: string,
    imageName: string,
    provider: "pixabay" | "pexels",
  ) => {
    if (!projectId) {
      toast.error("请先选择项目");
      return;
    }

    setSavingId(imageUrl);
    try {
      await importMaterialFromUrl({
        projectId,
        name: imageName,
        type: "image",
        url: imageUrl,
        tags: [provider],
      });
      toast.success("已保存到图片库");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`保存失败: ${message}`);
    } finally {
      setSavingId(null);
    }
  };

  const handleInsertImageToCanvas = (image: {
    id: string;
    previewUrl: string;
    largeUrl: string;
    pageUrl: string;
    tags: string;
    width: number;
    height: number;
    provider: "pixabay" | "pexels";
  }) => {
    if (!projectId) {
      toast.error("请先选择项目");
      return;
    }

    const target = getActiveContentTarget();
    const sameProjectTarget = target?.projectId === projectId ? target : null;
    const targetContentId = sameProjectTarget?.contentId ?? null;
    const targetCanvasType = normalizeCanvasType(sameProjectTarget?.canvasType);
    const targetTheme = mapCanvasTypeToTheme(targetCanvasType);
    const request = emitCanvasImageInsertRequest({
      projectId,
      contentId: targetContentId,
      canvasType: targetCanvasType,
      anchorHint:
        targetCanvasType === "video" ? "video_start_frame" : "section_end",
      source: image.provider === "pexels" ? "pexels" : "pixabay",
      image: {
        id: image.id,
        previewUrl: image.previewUrl,
        contentUrl: image.largeUrl || image.previewUrl,
        pageUrl: image.pageUrl,
        title: image.tags,
        width: image.width,
        height: image.height,
        attributionName: image.provider === "pexels" ? "Pexels" : "Pixabay",
        provider: image.provider,
      },
    });
    pendingInsertRequestMetaRef.current.set(request.requestId, {
      projectId,
      contentId: targetContentId,
      canvasType: targetCanvasType,
      theme: targetTheme,
      imageTitle: image.tags,
    });

    onNavigate?.("agent", {
      projectId,
      contentId: targetContentId ?? undefined,
      theme: targetTheme,
      lockTheme: false,
    });

    const canvasLabel = CANVAS_DISPLAY_NAME[targetCanvasType] || "当前画布";
    toast.success(`已发送到${canvasLabel}，正在自动定位`);
  };

  const handleRelocateToInsert = (entry: CanvasImageInsertHistoryEntry) => {
    onNavigate?.("agent", {
      projectId: entry.projectId,
      contentId: entry.contentId ?? undefined,
      theme: entry.theme,
      lockTheme: false,
    });
    const canvasLabel = CANVAS_DISPLAY_NAME[entry.canvasType] || "目标画布";
    toast.success(`正在定位到${canvasLabel}`);
  };

  const openPreviewWindow = async (url: string) => {
    if (!url) return;
    try {
      await openExternal(url);
    } catch (error) {
      console.error("打开预览窗口失败:", error);
      window.open(url, "_blank");
    }
  };

  return (
    <Container>
      <SearchPanel>
        <ComposerRow>
          <PromptArea
            placeholder="输入关键词搜索图片，例如：世界旅游胜地、科技感背景..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
          />

          <SearchButton
            $loading={loading}
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                搜索中...
              </>
            ) : (
              <>
                <Search size={16} />
                搜索图片
              </>
            )}
          </SearchButton>
        </ComposerRow>

        <SearchToolsRow>
          <FiltersRow>
            <RatioDropdown
              onClick={() => setRatioOpen(!ratioOpen)}
              onBlur={() => setTimeout(() => setRatioOpen(false), 150)}
            >
              <ImageIcon size={14} />
              {currentRatioLabel}
              <ChevronDown size={12} />
              <RatioOptions $open={ratioOpen}>
                {RATIO_OPTIONS.map((option) => (
                  <RatioOption
                    key={option.value}
                    $active={aspectRatio === option.value}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setAspectRatio(option.value);
                      setRatioOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setAspectRatio(option.value);
                        setRatioOpen(false);
                      }
                    }}
                  >
                    {option.icon} {option.label}
                  </RatioOption>
                ))}
              </RatioOptions>
            </RatioDropdown>
          </FiltersRow>

          <SourceTabs>
            {SOURCE_TABS.map((tab) => (
              <SourceTab
                key={tab.key}
                $active={searchSource === tab.key}
                onClick={() => setSearchSource(tab.key as SearchSource)}
              >
                <tab.icon size={13} />
                {tab.label}
              </SourceTab>
            ))}
          </SourceTabs>
        </SearchToolsRow>

        {recentInsertHistory.length > 0 && (
          <RecentInsertPanel>
            <RecentInsertHeader>最近插入记录（可一键定位）</RecentInsertHeader>
            <RecentInsertList>
              {recentInsertHistory.map((entry) => {
                const canvasLabel =
                  CANVAS_DISPLAY_NAME[entry.canvasType] || "画布";
                const locationLabel = entry.locationLabel || "已插入";
                return (
                  <RecentInsertItem key={entry.requestId}>
                    <RecentInsertMeta>
                      <RecentInsertTitle>
                        {entry.imageTitle?.trim() || "图片"} · {canvasLabel}
                      </RecentInsertTitle>
                      <RecentInsertHint>{locationLabel}</RecentInsertHint>
                    </RecentInsertMeta>
                    <RelocateButton
                      type="button"
                      onClick={() => handleRelocateToInsert(entry)}
                    >
                      再次定位
                    </RelocateButton>
                  </RecentInsertItem>
                );
              })}
            </RecentInsertList>
          </RecentInsertPanel>
        )}
      </SearchPanel>

      <ResultsArea>
        <ScrollArea className="h-full">
          {results.length === 0 && !loading ? (
            <EmptyState>
              <EmptyIcon>
                <ImageIcon size={36} />
              </EmptyIcon>
              <EmptyTitle>搜索海量图片</EmptyTitle>
              <EmptyHint>
                {error
                  ? `搜索失败：${error}`
                  : lastQuery
                    ? `未找到与「${lastQuery}」相关的图片，建议尝试英文关键词或更换来源。`
                    : `输入关键词搜索图片，结果来自 ${sourceHint.resultLabel}`}
              </EmptyHint>
            </EmptyState>
          ) : (
            <>
              {results.length > 0 && (
                <ResultCount>
                  共找到 {total.toLocaleString()} 张图片
                  {results.length < total && `，已加载 ${results.length} 张`}
                </ResultCount>
              )}

              <ImageGrid>
                {results.map((img, index) => {
                  const ratio = img.width / img.height;
                  const isSaving = savingId === img.largeUrl;
                  const displayName = img.tags.split(",")[0]?.trim() || "图片";

                  return (
                    <ImageCard
                      key={img.id}
                      $aspectRatio={ratio}
                      style={{ animationDelay: `${index * 30}ms` }}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        void openPreviewWindow(img.largeUrl || img.pageUrl);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openPreviewWindow(img.largeUrl || img.pageUrl);
                        }
                      }}
                    >
                      <img
                        src={img.largeUrl || img.previewUrl}
                        alt={img.tags}
                        loading="lazy"
                      />
                      <MetaBadge>
                        {img.width}×{img.height}
                      </MetaBadge>
                      <ProviderBadge>
                        {img.provider === "pixabay" ? "Pixabay" : "Pexels"}
                      </ProviderBadge>
                      <Overlay>
                        <OverlayActions>
                          <ActionButton
                            $primary
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveImage(
                                img.largeUrl,
                                displayName,
                                img.provider,
                              );
                            }}
                            disabled={isSaving}
                          >
                            {isSaving ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <>
                                <Download size={14} />
                                保存
                              </>
                            )}
                          </ActionButton>
                          <ActionButton
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInsertImageToCanvas(img);
                            }}
                          >
                            <FilePlus2 size={14} />
                            插入当前画布
                          </ActionButton>
                          <ActionButton
                            onClick={(e) => {
                              e.stopPropagation();
                              void openPreviewWindow(img.pageUrl);
                            }}
                          >
                            <ExternalLink size={14} />
                            预览
                          </ActionButton>
                        </OverlayActions>
                      </Overlay>
                    </ImageCard>
                  );
                })}
              </ImageGrid>

              {hasMore && (
                <LoadMoreButton
                  $loading={loading}
                  onClick={() => loadMore(searchSource)}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      加载中...
                    </>
                  ) : (
                    "加载更多"
                  )}
                </LoadMoreButton>
              )}
            </>
          )}
        </ScrollArea>
      </ResultsArea>

      {results.length > 0 && (
        <Footer>
          <span>
            已显示 {results.length} / {total.toLocaleString()} 张
          </span>
          <Attribution
            href={sourceHint.attributionUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            图片来源: {sourceHint.attributionName}
          </Attribution>
        </Footer>
      )}
    </Container>
  );
}

export default ImageSearchTab;
