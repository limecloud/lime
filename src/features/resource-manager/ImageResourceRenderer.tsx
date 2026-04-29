import {
  useRef,
  type RefCallback,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  LoaderCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  IMAGE_RESOURCE_SCALE_STEP,
  type ImageResourceViewControls,
  type Point,
} from "./imageResourceViewControls";
import type { ResourceManagerItem } from "./types";

interface ImageResourceRendererProps {
  item: ResourceManagerItem;
  controls: ImageResourceViewControls;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function ImageResourceRenderer({
  item,
  controls,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: ImageResourceRendererProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    cursor: Point;
    translate: Point;
  } | null>(null);

  const finishImageLoad = (image: HTMLImageElement) => {
    controls.setIsLoading(false);
    controls.setNaturalSize((current) => {
      if (
        current?.width === image.naturalWidth &&
        current.height === image.naturalHeight
      ) {
        return current;
      }
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    });
  };

  const handleImageRef: RefCallback<HTMLImageElement> = (node) => {
    imageRef.current = node;
    if (node?.complete && node.naturalWidth > 0) {
      finishImageLoad(node);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      cursor: { x: event.clientX, y: event.clientY },
      translate: controls.translate,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;

    controls.setTranslate({
      x: dragStart.translate.x + event.clientX - dragStart.cursor.x,
      y: dragStart.translate.y + event.clientY - dragStart.cursor.y,
    });
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    controls.zoomBy(
      event.deltaY > 0 ? -IMAGE_RESOURCE_SCALE_STEP : IMAGE_RESOURCE_SCALE_STEP,
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {hasPrevious ? (
        <button
          type="button"
          onClick={onPrevious}
          className="absolute left-5 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/88 text-slate-600 shadow-sm shadow-slate-950/10 transition hover:bg-white hover:text-slate-950"
          aria-label="查看上一张资源"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : null}

      {hasNext ? (
        <button
          type="button"
          onClick={onNext}
          className="absolute right-5 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/88 text-slate-600 shadow-sm shadow-slate-950/10 transition hover:bg-white hover:text-slate-950"
          aria-label="查看下一张资源"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      ) : null}

      <div
        data-testid="resource-manager-image-stage"
        className={cn(
          "relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden",
          controls.backdropMode === "dark" &&
            "bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.10),transparent_44%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,1))]",
          controls.backdropMode === "light" && "bg-[#f5f6f8]",
          controls.loadFailed
            ? "cursor-default"
            : "cursor-grab active:cursor-grabbing",
        )}
        style={controls.stageStyle}
        onPointerDown={controls.loadFailed ? undefined : handlePointerDown}
        onPointerMove={controls.loadFailed ? undefined : handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={controls.loadFailed ? undefined : handleWheel}
        onDoubleClick={controls.loadFailed ? undefined : controls.toggleFitMode}
      >
        {controls.isLoading && !controls.loadFailed ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm font-medium text-slate-500">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/92 px-4 py-2 shadow-sm shadow-slate-950/10">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              加载图片
            </div>
          </div>
        ) : null}

        {controls.loadFailed ? (
          <div className="max-w-sm px-6 text-center text-slate-500">
            <ImageOff className="mx-auto h-10 w-10 text-slate-500" />
            <div className="mt-4 text-sm font-semibold text-slate-900">
              图片暂时无法显示
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              当前图片地址加载失败，可以切换其他图片，或稍后重新打开查看。
            </div>
          </div>
        ) : (
          <img
            key={item.id}
            ref={handleImageRef}
            src={item.src ?? undefined}
            alt={item.title || item.description || "资源图片"}
            draggable={false}
            onLoad={(event) => {
              finishImageLoad(event.currentTarget);
            }}
            onError={() => {
              controls.setIsLoading(false);
              controls.setLoadFailed(true);
            }}
            className={cn(
              "object-contain shadow-sm shadow-slate-950/10 transition-transform duration-75",
              controls.fitMode === "fit"
                ? "max-h-full max-w-full"
                : "max-h-none max-w-none",
            )}
            style={{
              transform: controls.transform,
              transformOrigin: "center center",
            }}
          />
        )}
      </div>

      {controls.naturalSize && !controls.loadFailed ? (
        <div className="absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/92 px-3 py-2 text-xs font-medium text-slate-500 shadow-sm shadow-slate-950/10">
          <span>
            原始 {controls.naturalSize.width} × {controls.naturalSize.height}
          </span>
          <span>{controls.fitMode === "fit" ? "适应窗口" : "原图尺寸"}</span>
          {controls.rotation ? <span>旋转 {controls.rotation}°</span> : null}
          {controls.flipX ? <span>水平翻转</span> : null}
          {controls.flipY ? <span>垂直翻转</span> : null}
        </div>
      ) : null}
    </div>
  );
}
