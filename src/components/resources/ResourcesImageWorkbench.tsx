import { useEffect, useRef, useState } from "react";
import { ImagePlus, Images, LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { convertLocalFileSrc } from "@/lib/api/fileSystem";
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
import { ImageGallery } from "@/components/workspace/media/ImageGallery";
import type { GalleryMaterial } from "@/types/gallery-material";
import type { Page, PageParams } from "@/types/page";

interface ResourcesImageWorkbenchProps {
  projectId?: string | null;
  onNavigate?: (page: Page, params?: PageParams) => void;
  onUploadImage?: () => Promise<void> | void;
}

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

export function ResourcesImageWorkbench({
  projectId,
  onNavigate,
  onUploadImage,
}: ResourcesImageWorkbenchProps) {
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
    setSelectedMaterial(null);
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
      <section className="rounded-[26px] border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-950/5">
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/90 bg-white text-slate-700 shadow-sm">
            <Images className="h-7 w-7" />
          </div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-slate-900">
              先选择资料库
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              选择项目后，这里会统一承接本地图片上传、图片库浏览，以及插入当前画布。
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[26px] border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <Badge className="w-fit rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 hover:bg-sky-50">
              图片工作台
            </Badge>
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                我的图片库
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                本地图片上传与图片库插图动作已经收口到资料库图片视图。双击图片可直接插入当前画布，也可以先选中后再执行插入。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600"
              >
                {selectedMaterial
                  ? `已选中：${selectedMaterial.name}`
                  : "当前未选择图片"}
              </Badge>
              <Badge
                variant="outline"
                className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
              >
                与当前画布联动
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => {
                void onUploadImage?.();
              }}
            >
              <ImagePlus className="mr-2 h-4 w-4" />
              上传本地图片
            </Button>
            {recentInsertHistory[0] && (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => handleRelocate(recentInsertHistory[0])}
              >
                <LocateFixed className="mr-2 h-4 w-4" />
                再次定位
              </Button>
            )}
            <Button
              type="button"
              className="rounded-xl bg-slate-900 text-white hover:bg-slate-800"
              disabled={!selectedMaterial}
              onClick={() => {
                if (!selectedMaterial) {
                  return;
                }
                handleInsertFromGallery(selectedMaterial);
              }}
            >
              插入选中图片到当前画布
            </Button>
          </div>
        </div>

        {recentInsertHistory.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-3">
            {recentInsertHistory.map((entry) => (
              <div
                key={entry.requestId}
                className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {entry.imageTitle?.trim() || "图片"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {entry.locationLabel || "已插入当前画布"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    onClick={() => handleRelocate(entry)}
                  >
                    定位
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="min-h-[420px]">
          <ImageGallery
            projectId={projectId}
            className="h-full"
            maxHeight="calc(100vh - 420px)"
            selectedIds={selectedMaterial ? [selectedMaterial.id] : []}
            onSelect={(materials) => {
              setSelectedMaterial(materials[0] || null);
            }}
            onDoubleClick={handleInsertFromGallery}
          />
        </div>
      </div>
    </section>
  );
}
