/**
 * @file 图片搜索 Hook
 * @description 调用后端 Pixabay / 联网图片搜索命令，支持分源缓存
 * @module components/image-gen/hooks/useImageSearch
 */

import { useCallback, useState } from "react";
import {
  searchPixabayImages,
  searchWebImages,
  type AspectRatioFilter,
  type PixabaySearchRequest,
  type WebImageSearchRequest,
} from "@/lib/api/imageSearch";

export type { AspectRatioFilter } from "@/lib/api/imageSearch";

export type SearchSource = "web" | "pixabay";

export interface SearchImageResult {
  id: string;
  previewUrl: string;
  largeUrl: string;
  width: number;
  height: number;
  tags: string;
  pageUrl: string;
  user: string;
  provider: "pixabay" | "pexels";
}

interface SourceSearchState {
  results: SearchImageResult[];
  loading: boolean;
  total: number;
  page: number;
  error: string | null;
  lastQuery: string;
}

type SourceSearchStateMap = Record<SearchSource, SourceSearchState>;

const DEFAULT_PER_PAGE = 20;

function pickFirstString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function pickFirstNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function createInitialSourceState(): SourceSearchState {
  return {
    results: [],
    loading: false,
    total: 0,
    page: 1,
    error: null,
    lastQuery: "",
  };
}

function mapPixabayOrientation(
  aspectRatio: AspectRatioFilter,
): string | undefined {
  if (aspectRatio === "landscape") return "horizontal";
  if (aspectRatio === "portrait") return "vertical";
  return undefined;
}

function mapWebAspect(
  aspectRatio: AspectRatioFilter,
): AspectRatioFilter | undefined {
  return aspectRatio === "all" ? undefined : aspectRatio;
}

function filterSquareIfNeeded(
  results: SearchImageResult[],
  aspectRatio: AspectRatioFilter,
): SearchImageResult[] {
  if (aspectRatio !== "square") {
    return results;
  }

  return results.filter((img) => {
    const ratio = img.width / img.height;
    return ratio > 0.9 && ratio < 1.1;
  });
}

export function useImageSearch() {
  const [query, setQuery] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatioFilter>("all");
  const [sourceStates, setSourceStates] = useState<SourceSearchStateMap>({
    web: createInitialSourceState(),
    pixabay: createInitialSourceState(),
  });

  const search = useCallback(
    async (
      source: SearchSource,
      newQuery?: string,
      resetPage = true,
      targetPage?: number,
    ) => {
      const searchQuery = (newQuery ?? query).trim();
      if (!searchQuery) {
        setSourceStates((prev) => ({
          ...prev,
          [source]: {
            ...prev[source],
            results: [],
            total: 0,
            page: 1,
            error: null,
            lastQuery: "",
          },
        }));
        return;
      }

      const page = targetPage ?? (resetPage ? 1 : sourceStates[source].page);

      setSourceStates((prev) => ({
        ...prev,
        [source]: {
          ...prev[source],
          loading: true,
          error: null,
          page,
          lastQuery: searchQuery,
        },
      }));

      try {
        if (source === "pixabay") {
          const req: PixabaySearchRequest = {
            query: searchQuery,
            page,
            perPage: DEFAULT_PER_PAGE,
            orientation: mapPixabayOrientation(aspectRatio),
          };

          const response = await searchPixabayImages(req);

          const mapped = response.hits.map((hit) => ({
            id: String(hit.id),
            previewUrl: pickFirstString(hit.preview_url, hit.previewUrl),
            largeUrl: pickFirstString(hit.large_image_url, hit.largeImageUrl),
            width: pickFirstNumber(hit.image_width, hit.imageWidth),
            height: pickFirstNumber(hit.image_height, hit.imageHeight),
            tags: hit.tags,
            pageUrl: pickFirstString(hit.page_url, hit.pageUrl),
            user: hit.user,
            provider: "pixabay" as const,
          }));

          const filtered = filterSquareIfNeeded(mapped, aspectRatio);

          setSourceStates((prev) => {
            const nextResults = resetPage
              ? filtered
              : [...prev[source].results, ...filtered];
            return {
              ...prev,
              [source]: {
                ...prev[source],
                results: nextResults,
                total:
                  response.total_hits ?? response.totalHits ?? response.total,
                page,
                loading: false,
                error: null,
                lastQuery: searchQuery,
              },
            };
          });
          return;
        }

        const req: WebImageSearchRequest = {
          query: searchQuery,
          page,
          perPage: DEFAULT_PER_PAGE,
          aspect: mapWebAspect(aspectRatio),
        };
        const response = await searchWebImages(req);

        const normalizedHits =
          response.hits?.length > 0
            ? response.hits.map((hit) => ({
                id: hit.id,
                previewUrl: pickFirstString(
                  hit.thumbnail_url,
                  hit.thumbnailUrl,
                ),
                largeUrl: pickFirstString(hit.content_url, hit.contentUrl),
                width: pickFirstNumber(hit.width),
                height: pickFirstNumber(hit.height),
                tags: hit.name,
                pageUrl: pickFirstString(hit.host_page_url, hit.hostPageUrl),
                user: response.provider || "pexels",
                provider: "pexels" as const,
              }))
            : (response.photos || []).map((photo) => {
                const contentUrl = pickFirstString(
                  photo.src.large2x,
                  photo.src.large,
                  photo.src.original,
                  photo.src.landscape,
                  photo.src.portrait,
                  photo.src.medium,
                  photo.src.small,
                  photo.src.tiny,
                );
                const previewUrl = pickFirstString(
                  photo.src.medium,
                  photo.src.small,
                  photo.src.tiny,
                  photo.src.landscape,
                  photo.src.portrait,
                  contentUrl,
                );
                return {
                  id: String(photo.id),
                  previewUrl,
                  largeUrl: contentUrl,
                  width: pickFirstNumber(photo.width),
                  height: pickFirstNumber(photo.height),
                  tags: photo.alt || "Pexels Image",
                  pageUrl: photo.url,
                  user: response.provider || "pexels",
                  provider: "pexels" as const,
                };
              });

        const mapped = normalizedHits.filter(
          (hit) =>
            hit.previewUrl && hit.largeUrl && hit.width > 0 && hit.height > 0,
        );
        const filtered = filterSquareIfNeeded(mapped, aspectRatio);
        setSourceStates((prev) => {
          const nextResults = resetPage
            ? filtered
            : [...prev[source].results, ...filtered];
          return {
            ...prev,
            [source]: {
              ...prev[source],
              results: nextResults,
              total: response.total || response.totalResults || filtered.length,
              page,
              loading: false,
              error: null,
              lastQuery: searchQuery,
            },
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${source} 搜索失败:`, error);
        setSourceStates((prev) => ({
          ...prev,
          [source]: {
            ...prev[source],
            loading: false,
            error: message,
            ...(resetPage
              ? {
                  results: [],
                  total: 0,
                  page: 1,
                }
              : {}),
          },
        }));
      }
    },
    [aspectRatio, query, sourceStates],
  );

  const loadMore = useCallback(
    (source: SearchSource) => {
      const current = sourceStates[source];
      if (current.loading || current.results.length >= current.total) {
        return;
      }

      const nextPage = current.page + 1;
      const nextQuery = current.lastQuery || query.trim();
      if (!nextQuery) {
        return;
      }
      void search(source, nextQuery, false, nextPage);
    },
    [query, search, sourceStates],
  );

  const clear = useCallback((source?: SearchSource) => {
    if (source) {
      setSourceStates((prev) => ({
        ...prev,
        [source]: createInitialSourceState(),
      }));
      return;
    }

    setSourceStates({
      web: createInitialSourceState(),
      pixabay: createInitialSourceState(),
    });
    setQuery("");
  }, []);

  return {
    query,
    setQuery,
    aspectRatio,
    setAspectRatio,
    sourceStates,
    search,
    loadMore,
    clear,
  };
}
