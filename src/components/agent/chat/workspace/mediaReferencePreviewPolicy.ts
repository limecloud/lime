export const MEDIA_REFERENCE_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const MEDIA_REFERENCE_PREVIEW_CHUNK_BYTES = 4 * 1024 * 1024;

const MEDIA_REFERENCE_PREVIEW_POLICY_SCHEMA =
  "lime.media_reference.preview_policy.v1";

export type MediaReferencePreviewPolicy =
  | "direct_owner"
  | "source_path_owner"
  | "sidecar_metadata_fallback"
  | "sidecar_progress"
  | "sidecar_read"
  | "sidecar_object_url"
  | "sidecar_preview_budget_exceeded"
  | "sidecar_page_window";

export interface MediaReferencePreviewBudgetFacts {
  canReadNextPage?: boolean;
  canReadPreviousPage?: boolean;
  chunkBytes?: number;
  loadedBytes?: number;
  maxBytes?: number;
  nextOffset?: number;
  pageIndex?: number;
  pageLength?: number;
  pageOffset?: number;
  previousOffset?: number;
  totalBytes?: number;
}

export function normalizeMediaReadNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function mediaReferencePreviewPolicyMeta(params: {
  policy: MediaReferencePreviewPolicy;
  facts?: MediaReferencePreviewBudgetFacts;
}): Record<string, unknown> {
  const facts = params.facts ?? {};
  const maxBytes = normalizeMediaReadNumber(facts.maxBytes);
  const chunkBytes = normalizeMediaReadNumber(facts.chunkBytes);
  const totalBytes = normalizeMediaReadNumber(facts.totalBytes);
  const loadedBytes = normalizeMediaReadNumber(facts.loadedBytes);
  const nextOffset = normalizeMediaReadNumber(facts.nextOffset);
  const previousOffset = normalizeMediaReadNumber(facts.previousOffset);
  const pageOffset = normalizeMediaReadNumber(facts.pageOffset);
  const pageLength = normalizeMediaReadNumber(facts.pageLength);
  const pageIndex = normalizeMediaReadNumber(facts.pageIndex);
  return {
    mediaPreviewPolicySchema: MEDIA_REFERENCE_PREVIEW_POLICY_SCHEMA,
    mediaPreviewPolicy: params.policy,
    mediaPreviewMaxBytes: maxBytes ?? MEDIA_REFERENCE_PREVIEW_MAX_BYTES,
    mediaPreviewChunkBytes: chunkBytes ?? MEDIA_REFERENCE_PREVIEW_CHUNK_BYTES,
    mediaPreviewRequiresPagination:
      params.policy === "sidecar_preview_budget_exceeded" ||
      params.policy === "sidecar_page_window",
    mediaPreviewLoadedBytes: loadedBytes ?? undefined,
    mediaPreviewNextOffset: nextOffset ?? undefined,
    mediaPreviewPreviousOffset: previousOffset ?? undefined,
    mediaPreviewTotalBytes: totalBytes ?? undefined,
    mediaPreviewPageOffset: pageOffset ?? undefined,
    mediaPreviewPageLength: pageLength ?? undefined,
    mediaPreviewPageIndex: pageIndex ?? undefined,
    mediaPreviewCanReadNextPage: facts.canReadNextPage,
    mediaPreviewCanReadPreviousPage: facts.canReadPreviousPage,


    mediaArtifactBoundary: "source_owned_media_payload",
  };
}
