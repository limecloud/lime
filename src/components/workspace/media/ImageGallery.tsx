/**
 * @file ImageGallery.tsx
 * @description 项目资料图片组件，用于项目图片管理和选择
 * @module components/workspace/media/ImageGallery
 */

import { useState, useMemo } from "react";
import { useGalleryMaterial } from "@/hooks/useGalleryMaterial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { convertLocalFileSrc } from "@/lib/api/fileSystem";
import {
  SearchIcon,
  ImageIcon,
  CheckIcon,
  XIcon,
  GridIcon,
  ListIcon,
} from "lucide-react";
import type { GalleryMaterial, ImageCategory } from "@/types/gallery-material";
import {
  IMAGE_CATEGORY_NAMES,
  IMAGE_CATEGORY_ICONS,
} from "@/types/gallery-material";
import { cn } from "@/lib/utils";

export interface ImageGalleryProps {
  /** 项目 ID */
  projectId: string;
  /** 选中的素材 ID 列表 */
  selectedIds?: string[];
  /** 是否允许多选 */
  multiple?: boolean;
  /** 选择变化回调 */
  onSelect?: (materials: GalleryMaterial[]) => void;
  /** 双击素材回调（用于直接应用到画布） */
  onDoubleClick?: (material: GalleryMaterial) => void;
  /** 自定义类名 */
  className?: string;
  /** 最大高度 */
  maxHeight?: string | number;
}

const ALL_CATEGORIES: ImageCategory[] = [
  "background",
  "product",
  "person",
  "decoration",
  "texture",
  "other",
];

const IMAGE_GALLERY_ACTIVE_FILTER_CLASSNAME =
  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10 hover:opacity-95";

const IMAGE_GALLERY_SELECTED_SURFACE_CLASSNAME =
  "border-emerald-200 ring-2 ring-emerald-100 shadow-lg shadow-emerald-950/10";

const IMAGE_GALLERY_SELECTED_BADGE_CLASSNAME =
  "border border-emerald-200 bg-white/90 text-emerald-700 shadow-sm shadow-emerald-950/10";

const IMAGE_GALLERY_INFO_SURFACE_CLASSNAME =
  "pointer-events-none absolute inset-x-2 bottom-2 rounded-[1rem] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_48%,rgba(240,249,255,0.96)_100%)] p-3 text-slate-800 shadow-sm shadow-sky-950/10";

function normalizePreviewSrc(src?: string | null): string | null {
  const normalized = src?.trim();
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("data:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("asset:") ||
    normalized.startsWith("file:")
  ) {
    return normalized;
  }

  return convertLocalFileSrc(normalized);
}

function getMaterialPreviewUrl(material: GalleryMaterial): string | null {
  return (
    normalizePreviewSrc(material.metadata?.thumbnail) ??
    normalizePreviewSrc(material.filePath)
  );
}

/**
 * 项目资料图片组件
 *
 * 提供项目图片的浏览、筛选和选择功能。
 */
export function ImageGallery({
  projectId,
  selectedIds = [],
  multiple = false,
  onSelect,
  onDoubleClick,
  className,
  maxHeight = "400px",
}: ImageGalleryProps) {
  const { materials, loading, filter, setFilter } = useGalleryMaterial(
    projectId,
    { type: "image" },
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedCategory, setSelectedCategory] =
    useState<ImageCategory | null>(null);

  // 本地筛选
  const filteredMaterials = useMemo(() => {
    let result = materials;

    // 按分类筛选
    if (selectedCategory) {
      result = result.filter(
        (m) => m.metadata?.imageCategory === selectedCategory,
      );
    }

    // 按搜索关键词筛选
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.description?.toLowerCase().includes(query) ||
          m.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [materials, selectedCategory, searchQuery]);

  const handleCategoryFilter = (category: ImageCategory | null) => {
    setSelectedCategory(category);
    setFilter({ ...filter, imageCategory: category || undefined });
  };

  const handleSelect = (material: GalleryMaterial) => {
    if (!onSelect) return;

    if (multiple) {
      const isSelected = selectedIds.includes(material.id);
      if (isSelected) {
        onSelect(
          materials.filter(
            (m) => selectedIds.includes(m.id) && m.id !== material.id,
          ),
        );
      } else {
        onSelect([
          ...materials.filter((m) => selectedIds.includes(m.id)),
          material,
        ]);
      }
    } else {
      onSelect([material]);
    }
  };

  const isSelected = (id: string) => selectedIds.includes(id);

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[18rem] items-center justify-center rounded-[1.5rem] border border-slate-200/80 bg-white/90",
          className,
        )}
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm shadow-slate-950/5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="搜索图片..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 rounded-xl border-slate-200/80 bg-white pl-9 pr-9 text-sm shadow-sm shadow-slate-950/5 transition focus-visible:ring-sky-100"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setSearchQuery("")}
              >
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <div className="inline-flex items-center rounded-xl border border-slate-200/80 bg-slate-50/90 p-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-lg text-slate-500",
                viewMode === "grid"
                  ? "bg-white text-slate-900 shadow-sm shadow-slate-950/5"
                  : "hover:bg-white/80 hover:text-slate-900",
              )}
              onClick={() => setViewMode("grid")}
            >
              <GridIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-lg text-slate-500",
                viewMode === "list"
                  ? "bg-white text-slate-900 shadow-sm shadow-slate-950/5"
                  : "hover:bg-white/80 hover:text-slate-900",
              )}
              onClick={() => setViewMode("list")}
            >
              <ListIcon className="h-4 w-4" />
            </Button>
          </div>

          <div className="inline-flex min-h-10 items-center rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 text-xs font-medium text-slate-500">
            共 {filteredMaterials.length} 张图片
            {selectedIds.length > 0 && `，已选 ${selectedIds.length} 张`}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 rounded-full border px-3 text-xs font-medium transition",
              !selectedCategory
                ? IMAGE_GALLERY_ACTIVE_FILTER_CLASSNAME
                : "border-slate-200/80 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
            )}
            onClick={() => handleCategoryFilter(null)}
          >
            全部
          </Button>
          {ALL_CATEGORIES.map((category) => (
            <Button
              key={category}
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 rounded-full border px-3 text-xs font-medium transition",
                selectedCategory === category
                  ? IMAGE_GALLERY_ACTIVE_FILTER_CLASSNAME
                  : "border-slate-200/80 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
              )}
              onClick={() => handleCategoryFilter(category)}
            >
              <span className="mr-1">{IMAGE_CATEGORY_ICONS[category]}</span>
              {IMAGE_CATEGORY_NAMES[category]}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea
        style={{ maxHeight }}
        className="flex-1 min-h-0 rounded-[1.5rem] border border-slate-200/80 bg-white/92 shadow-sm shadow-slate-950/5"
      >
        {filteredMaterials.length === 0 ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 px-6 py-12 text-center text-slate-500">
            <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-sky-50 to-slate-100 text-sky-700">
              <ImageIcon className="h-10 w-10 opacity-80" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold text-slate-900">
                暂无图片素材
              </p>
              <p className="text-sm">
                可以先在 Claw 用 @素材
                搜图，或到项目资料上传本地图片，再回到这里筛选和插入。
              </p>
            </div>
          </div>
        ) : viewMode === "grid" ? (
          <div
            className="grid gap-3 p-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            }}
          >
            {filteredMaterials.map((material) => {
              const previewUrl = getMaterialPreviewUrl(material);
              return (
                <div
                  key={material.id}
                  className={cn(
                    "group relative aspect-square cursor-pointer overflow-hidden rounded-[1.25rem] border bg-slate-50 shadow-sm shadow-slate-950/5 transition-all",
                    isSelected(material.id)
                      ? IMAGE_GALLERY_SELECTED_SURFACE_CLASSNAME
                      : "border-slate-200/80 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-950/10",
                  )}
                  onClick={() => handleSelect(material)}
                  onDoubleClick={() => onDoubleClick?.(material)}
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={material.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400">
                      <ImageIcon className="h-9 w-9" />
                    </div>
                  )}

                  <div className={IMAGE_GALLERY_INFO_SURFACE_CLASSNAME}>
                    <div className="truncate text-sm font-semibold">
                      {material.name}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-600">
                      {material.metadata?.width &&
                        material.metadata?.height && (
                          <span>
                            {material.metadata.width}×{material.metadata.height}
                          </span>
                        )}
                      {material.metadata?.imageCategory && (
                        <span>
                          {
                            IMAGE_CATEGORY_NAMES[
                              material.metadata.imageCategory as ImageCategory
                            ]
                          }
                        </span>
                      )}
                    </div>
                  </div>

                  {material.metadata?.imageCategory && (
                    <div className="absolute left-2 top-2">
                      <Badge className="rounded-full border border-white/60 bg-white/88 px-2 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm">
                        <span className="mr-1">
                          {
                            IMAGE_CATEGORY_ICONS[
                              material.metadata.imageCategory as ImageCategory
                            ]
                          }
                        </span>
                        {
                          IMAGE_CATEGORY_NAMES[
                            material.metadata.imageCategory as ImageCategory
                          ]
                        }
                      </Badge>
                    </div>
                  )}

                  {isSelected(material.id) && (
                    <div
                      className={cn(
                        "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full",
                        IMAGE_GALLERY_SELECTED_BADGE_CLASSNAME,
                      )}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-slate-200/80 p-2">
            {filteredMaterials.map((material) => {
              const previewUrl = getMaterialPreviewUrl(material);
              return (
                <div
                  key={material.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-[1rem] px-3 py-2.5 transition-colors",
                    isSelected(material.id)
                      ? "bg-[linear-gradient(135deg,rgba(240,253,250,0.92)_0%,rgba(236,253,245,0.9)_52%,rgba(224,242,254,0.9)_100%)]"
                      : "hover:bg-slate-50",
                  )}
                  onClick={() => handleSelect(material)}
                  onDoubleClick={() => onDoubleClick?.(material)}
                >
                  <div className="h-14 w-14 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100 shadow-sm">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={material.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {material.name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {material.metadata?.imageCategory && (
                        <span>
                          {
                            IMAGE_CATEGORY_NAMES[
                              material.metadata.imageCategory as ImageCategory
                            ]
                          }
                        </span>
                      )}
                      {material.metadata?.width &&
                        material.metadata?.height && (
                          <span>
                            {material.metadata.width}×{material.metadata.height}
                          </span>
                        )}
                      {material.tags.length > 0 && (
                        <span className="truncate">
                          {material.tags.slice(0, 2).join(" / ")}
                        </span>
                      )}
                    </div>
                  </div>

                  {isSelected(material.id) && (
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full",
                        IMAGE_GALLERY_SELECTED_BADGE_CLASSNAME,
                      )}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="flex items-center justify-between gap-3 px-1 text-xs text-slate-500">
        <span>双击图片可直接插入当前画布</span>
        <span>
          共 {filteredMaterials.length} 张图片
          {selectedIds.length > 0 && `，已选 ${selectedIds.length} 张`}
        </span>
      </div>
    </div>
  );
}

export default ImageGallery;
