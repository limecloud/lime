/**
 * @file 我的图片库 Tab
 * @description 显示用户已保存的图片素材库
 * @module components/image-gen/tabs/MyGalleryTab
 */

import { convertLocalFileSrc } from "@/lib/api/fileSystem";
import type { GalleryMaterial } from "@/types/gallery-material";
import { toast } from "sonner";
import { Images } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
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
import { ImageGallery } from "@/lib/workspace/workbenchUi";
import type { Page, PageParams } from "@/types/page";

export interface MyGalleryTabProps {
  /** 项目 ID */
  projectId?: string | null;
  /** 页面跳转 */
  onNavigate?: (page: Page, params?: PageParams) => void;
}

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: linear-gradient(180deg, hsl(210 40% 98%) 0%, hsl(0 0% 100%) 100%);
`;

const ActionBar = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid hsl(var(--border) / 0.78);
  border-radius: 24px;
  background: hsl(var(--background) / 0.84);
  box-shadow:
    0 16px 38px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const ActionCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const ActionEyebrow = styled.span`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  border: 1px solid hsl(203 82% 88%);
  background: hsl(200 100% 97%);
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: hsl(211 58% 38%);
`;

const ActionTitle = styled.div`
  font-size: 22px;
  line-height: 1.1;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const ActionHint = styled.div`
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const InsertButton = styled.button`
  height: 40px;
  border: 1px solid hsl(215 28% 17% / 0.92);
  background: linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%));
  color: hsl(var(--background));
  border-radius: 14px;
  font-size: 13px;
  font-weight: 700;
  padding: 0 16px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 16px 32px hsl(220 40% 12% / 0.14);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RelocateButton = styled(InsertButton)`
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 600;
  padding: 0 14px;
  box-shadow: none;
`;

const RecentList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const RecentCard = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 16px;
  border: 1px solid hsl(var(--border) / 0.82);
  background: hsl(var(--background) / 0.84);
`;

const RecentMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RecentTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RecentHint = styled.div`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const GalleryPanel = styled.div`
  flex: 1;
  min-height: 0;
  padding: 14px;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--background) / 0.84);
  box-shadow:
    0 18px 42px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  overflow: hidden;
`;

const GalleryContent = styled(ImageGallery)`
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;

  > div:last-child {
    flex: 1;
    min-height: 0;
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 16px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  padding: 48px 24px;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--background) / 0.84);
  box-shadow:
    0 18px 42px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
`;

const EmptyIcon = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 20px;
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

const EmptyTitle = styled.p`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const EmptyHint = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
`;

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
  return filtered.slice(0, 3);
}

export function MyGalleryTab({ projectId, onNavigate }: MyGalleryTabProps) {
  const [selectedMaterial, setSelectedMaterial] =
    useState<GalleryMaterial | null>(null);
  const [recentInsertHistory, setRecentInsertHistory] = useState<
    CanvasImageInsertHistoryEntry[]
  >(() => getVisibleInsertHistory(projectId));
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

      if (!ack.success) {
        toast.error("插图失败，请返回创作区重试");
        return;
      }

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
        ).slice(0, 3),
      );
    });

    return unsubscribe;
  }, [projectId]);

  const handleInsertFromGallery = (material: GalleryMaterial) => {
    if (!projectId) {
      toast.error("请先选择项目");
      return;
    }

    const imageUrl = material.filePath
      ? convertLocalFileSrc(material.filePath)
      : material.metadata?.thumbnail || "";
    if (!imageUrl) {
      toast.error("该素材缺少可用图片地址，无法插入");
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
      source: "gallery",
      image: {
        id: material.id,
        previewUrl: material.metadata?.thumbnail || imageUrl,
        contentUrl: imageUrl,
        title: material.name,
        width: material.metadata?.width,
        height: material.metadata?.height,
        attributionName: "项目素材库",
        provider: "gallery",
      },
    });
    pendingInsertRequestMetaRef.current.set(request.requestId, {
      projectId,
      contentId: targetContentId,
      canvasType: targetCanvasType,
      theme: targetTheme,
      imageTitle: material.name,
    });

    onNavigate?.("agent", {
      projectId,
      contentId: targetContentId ?? undefined,
      theme: targetTheme,
      lockTheme: false,
    });
    toast.success("已发送到当前画布，正在自动定位");
  };

  const handleRelocate = (entry: CanvasImageInsertHistoryEntry) => {
    onNavigate?.("agent", {
      projectId: entry.projectId,
      contentId: entry.contentId ?? undefined,
      theme: entry.theme,
      lockTheme: false,
    });
    toast.success("正在定位到插图位置");
  };

  if (!projectId) {
    return (
      <Container>
        <EmptyState>
          <EmptyIcon>
            <Images size={28} />
          </EmptyIcon>
          <EmptyTitle>请先选择项目</EmptyTitle>
          <EmptyHint>在右上角选择一个项目后即可查看图片库</EmptyHint>
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container>
      <ActionBar>
        <ActionRow>
          <ActionCopy>
            <ActionEyebrow>GALLERY</ActionEyebrow>
            <ActionTitle>我的图片库</ActionTitle>
            <ActionHint>
              {selectedMaterial
                ? `已选中：${selectedMaterial.name}`
                : "双击图片可直接插入当前画布，或先单击选中后再执行插入。"}
            </ActionHint>
          </ActionCopy>
          <ActionButtons>
            {recentInsertHistory[0] && (
              <RelocateButton
                type="button"
                onClick={() => handleRelocate(recentInsertHistory[0])}
              >
                再次定位
              </RelocateButton>
            )}
            <InsertButton
              type="button"
              disabled={!selectedMaterial}
              onClick={() => {
                if (!selectedMaterial) {
                  return;
                }
                handleInsertFromGallery(selectedMaterial);
              }}
            >
              插入选中图片到当前画布
            </InsertButton>
          </ActionButtons>
        </ActionRow>

        {recentInsertHistory.length > 0 && (
          <RecentList>
            {recentInsertHistory.map((entry) => (
              <RecentCard key={entry.requestId}>
                <RecentMeta>
                  <RecentTitle>
                    {entry.imageTitle?.trim() || "图片"}
                  </RecentTitle>
                  <RecentHint>{entry.locationLabel || "已插入"}</RecentHint>
                </RecentMeta>
                <RelocateButton
                  type="button"
                  onClick={() => handleRelocate(entry)}
                >
                  定位
                </RelocateButton>
              </RecentCard>
            ))}
          </RecentList>
        )}
      </ActionBar>
      <GalleryPanel>
        <GalleryContent
          projectId={projectId}
          className="h-full"
          maxHeight="calc(100vh - 250px)"
          selectedIds={selectedMaterial ? [selectedMaterial.id] : []}
          onSelect={(materials) => {
            setSelectedMaterial(materials[0] || null);
          }}
          onDoubleClick={handleInsertFromGallery}
        />
      </GalleryPanel>
    </Container>
  );
}

export default MyGalleryTab;
