import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  definedString,
  normalizeProjectionIdList,
  readRecord,
  readStringArray,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiImageInputStage = "submit" | "restore" | "hydrate";

export type AgentUiImageInputKind = "local" | "remote" | "data";

export type AgentUiImageInputIssueCode =
  | "missing_image_input"
  | "local_image_detail_not_default_high"
  | "local_image_detail_not_preserved"
  | "unsupported_low_detail"
  | "remote_http_submitted_to_model"
  | "remote_rejection_missing"
  | "data_url_rejected"
  | "restored_image_lost"
  | "hydrated_image_lost"
  | "image_order_drift"
  | "placeholder_map_drift"
  | "legacy_text_placeholder_only";

export interface AgentUiImageInputIssue {
  code: AgentUiImageInputIssueCode;
  path: string;
  message: string;
}

export interface AgentUiImageInputProjectionInput {
  stage?: string | null;
  draft?: unknown;
  submittedInput?: unknown;
  modelRequestInput?: unknown;
  restoredDraft?: unknown;
  hydratedUserItems?: unknown;
  remoteRejections?: unknown;
  visibleTranscriptItems?: unknown;
}

export interface AgentUiImageInputRef {
  index: number;
  kind: AgentUiImageInputKind;
  source: string;
  detail: string;
  placeholder?: string;
}

export interface AgentUiImageInputSnapshot {
  stage: AgentUiImageInputStage;
  draftImages: AgentUiImageInputRef[];
  submittedImages: AgentUiImageInputRef[];
  modelRequestImages: AgentUiImageInputRef[];
  restoredImages: AgentUiImageInputRef[];
  hydratedImages: AgentUiImageInputRef[];
  remoteRejectedUrls: string[];
  localDetailStable: boolean;
  remoteHttpRejected: boolean;
  dataUrlsAccepted: boolean;
  restoreStable: boolean;
  hydrateStable: boolean;
  placeholderMapStable: boolean;
  validationIssues: AgentUiImageInputIssue[];
}

function issue(
  code: AgentUiImageInputIssueCode,
  path: string,
  message: string,
): AgentUiImageInputIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStage(
  value: string | null | undefined,
): AgentUiImageInputStage {
  switch (value) {
    case "restore":
    case "queued_restore":
    case "cancel_restore":
      return "restore";
    case "hydrate":
      return "hydrate";
    default:
      return "submit";
  }
}

function imageKind(source: string): AgentUiImageInputKind {
  if (/^data:image\//i.test(source)) return "data";
  if (/^https?:\/\//i.test(source)) return "remote";
  return "local";
}

function normalizeDetail(
  kind: AgentUiImageInputKind,
  detail: string | undefined,
): string {
  if (detail) return detail.toLowerCase();
  return kind === "local" || kind === "data" ? "high" : "auto";
}

function imageRef(
  value: unknown,
  index: number,
): AgentUiImageInputRef | undefined {
  if (typeof value === "string") {
    const source = definedString(value);
    if (!source) return undefined;
    const kind = imageKind(source);
    return {
      index,
      kind,
      source,
      detail: normalizeDetail(kind, undefined),
    };
  }
  const record = readRecord(value);
  if (!record) return undefined;
  const source = readStringField(record, [
    "path",
    "url",
    "uri",
    "image_url",
    "imageUrl",
    "source",
  ]);
  if (!source) return undefined;
  const kind = imageKind(source);
  return compactProjectionFields({
    index,
    kind,
    source,
    detail: normalizeDetail(kind, readStringField(record, ["detail"])),
    placeholder: readStringField(record, ["placeholder", "token", "label"]),
  } satisfies AgentUiImageInputRef);
}

function draftImages(value: unknown): AgentUiImageInputRef[] {
  const record = readRecord(value) ?? {};
  const images = [
    ...readArray(record.localImages ?? record.local_images),
    ...readArray(record.remoteImageUrls ?? record.remote_image_urls),
  ];
  return images
    .map(imageRef)
    .filter((item): item is AgentUiImageInputRef => Boolean(item))
    .map((item, index) => ({ ...item, index }));
}

function submittedImages(value: unknown): AgentUiImageInputRef[] {
  const items = readArray(value);
  const flatItems = items.flatMap((item) => {
    const record = readRecord(item);
    if (!record) return [item];
    const content = readArray(record.content);
    return content.length > 0 ? content : [item];
  });
  return flatItems
    .map(imageRef)
    .filter((item): item is AgentUiImageInputRef => Boolean(item))
    .map((item, index) => ({ ...item, index }));
}

function remoteRejectedUrls(value: unknown): string[] {
  return normalizeProjectionIdList(
    readArray(value)
      .flatMap((item) => {
        if (typeof item === "string") return [item];
        const record = readRecord(item);
        return [
          readStringField(record, ["url", "uri", "image_url", "imageUrl"]),
          ...readStringArray(record?.urls),
        ];
      })
      .filter((item): item is string => Boolean(item)),
  );
}

function signature(image: AgentUiImageInputRef): string {
  return `${image.kind}:${image.source}:${image.detail}`;
}

function placeholderSignature(image: AgentUiImageInputRef): string {
  return `${image.placeholder ?? ""}:${image.source}`;
}

function sameOrdered(
  expected: readonly AgentUiImageInputRef[],
  actual: readonly AgentUiImageInputRef[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every(
    (image, index) => signature(image) === signature(actual[index]),
  );
}

function samePlaceholders(
  expected: readonly AgentUiImageInputRef[],
  actual: readonly AgentUiImageInputRef[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every(
    (image, index) =>
      placeholderSignature(image) === placeholderSignature(actual[index]),
  );
}

function acceptedDraftImages(
  images: readonly AgentUiImageInputRef[],
): AgentUiImageInputRef[] {
  return images.filter((image) => image.kind !== "remote");
}

function textContainsLegacyPlaceholder(value: unknown): boolean {
  const records = readArray(value);
  return records.some((item) => {
    const record = readRecord(item);
    const text =
      (typeof item === "string" ? item : undefined) ??
      readStringField(record, ["text", "content", "preview"]);
    return Boolean(text?.match(/\[Image #\d+\]/));
  });
}

function detailMap(
  images: readonly AgentUiImageInputRef[],
): Map<string, string> {
  return new Map(images.map((image) => [image.source, image.detail]));
}

function localDetailStable(
  draft: readonly AgentUiImageInputRef[],
  submitted: readonly AgentUiImageInputRef[],
): boolean {
  const submittedDetails = detailMap(submitted);
  return draft
    .filter((image) => image.kind === "local")
    .every((image) => submittedDetails.get(image.source) === image.detail);
}

function hasUnsupportedLowDetail(
  images: readonly AgentUiImageInputRef[],
): boolean {
  return images.some((image) => image.detail === "low");
}

function validateSnapshot(
  input: AgentUiImageInputProjectionInput,
  snapshot: Omit<AgentUiImageInputSnapshot, "validationIssues">,
): AgentUiImageInputIssue[] {
  const issues: AgentUiImageInputIssue[] = [];
  const allImages = [
    ...snapshot.draftImages,
    ...snapshot.submittedImages,
    ...snapshot.modelRequestImages,
    ...snapshot.restoredImages,
    ...snapshot.hydratedImages,
  ];
  if (allImages.length === 0) {
    issues.push(
      issue(
        "missing_image_input",
        "$",
        "Image input guard requires at least one image ref.",
      ),
    );
  }
  if (hasUnsupportedLowDetail(allImages)) {
    issues.push(
      issue(
        "unsupported_low_detail",
        "$.detail",
        "Image detail low is unsupported; use high, original, or auto.",
      ),
    );
  }
  const localDraftWithoutDetail = draftImages(input.draft).filter(
    (image) => image.kind === "local" && image.detail === "high",
  );
  const submittedDetails = detailMap(snapshot.submittedImages);
  if (
    localDraftWithoutDetail.some(
      (image) =>
        submittedDetails.has(image.source) &&
        submittedDetails.get(image.source) !== "high",
    )
  ) {
    issues.push(
      issue(
        "local_image_detail_not_default_high",
        "$.submittedInput",
        "Local images without explicit detail must submit as high detail.",
      ),
    );
  }
  if (!snapshot.localDetailStable) {
    issues.push(
      issue(
        "local_image_detail_not_preserved",
        "$.submittedInput",
        "Custom local image detail must be preserved through submission.",
      ),
    );
  }
  const submittedRemote = [
    ...snapshot.submittedImages,
    ...snapshot.modelRequestImages,
  ].filter((image) => image.kind === "remote");
  if (submittedRemote.length > 0) {
    issues.push(
      issue(
        "remote_http_submitted_to_model",
        "$.modelRequestInput",
        "Remote HTTP(S) image URLs must not reach turn/start or model input.",
      ),
    );
  }
  const draftRemote = snapshot.draftImages.filter(
    (image) => image.kind === "remote",
  );
  if (
    draftRemote.some(
      (image) => !snapshot.remoteRejectedUrls.includes(image.source),
    )
  ) {
    issues.push(
      issue(
        "remote_rejection_missing",
        "$.remoteRejections",
        "Remote HTTP(S) image URLs must have explicit rejection evidence.",
      ),
    );
  }
  const dataDraft = snapshot.draftImages.filter(
    (image) => image.kind === "data",
  );
  if (
    dataDraft.some(
      (image) =>
        !snapshot.submittedImages.some(
          (submitted) => submitted.source === image.source,
        ) &&
        !snapshot.modelRequestImages.some(
          (submitted) => submitted.source === image.source,
        ),
    )
  ) {
    issues.push(
      issue(
        "data_url_rejected",
        "$.submittedInput",
        "Inline data image URLs are valid image inputs and must be forwarded.",
      ),
    );
  }
  if (!snapshot.restoreStable) {
    issues.push(
      issue(
        "restored_image_lost",
        "$.restoredDraft",
        "Image refs must survive blocked/queued/cancel restore.",
      ),
    );
  }
  if (!snapshot.hydrateStable) {
    issues.push(
      issue(
        "hydrated_image_lost",
        "$.hydratedUserItems",
        "Image refs must survive history hydrate.",
      ),
    );
  }
  if (
    snapshot.restoredImages.length > 0 &&
    !sameOrdered(snapshot.draftImages, snapshot.restoredImages)
  ) {
    issues.push(
      issue(
        "image_order_drift",
        "$.restoredDraft",
        "Image restore must keep local/remote/data image order stable.",
      ),
    );
  }
  if (!snapshot.placeholderMapStable) {
    issues.push(
      issue(
        "placeholder_map_drift",
        "$.restoredDraft",
        "Image placeholder labels must stay attached to the same image refs.",
      ),
    );
  }
  if (
    snapshot.draftImages.length === 0 &&
    textContainsLegacyPlaceholder(input.visibleTranscriptItems)
  ) {
    issues.push(
      issue(
        "legacy_text_placeholder_only",
        "$.visibleTranscriptItems",
        "Image placeholders without structured image refs cannot prove image restore/hydrate.",
      ),
    );
  }
  return issues;
}

export function extractLocalRemoteImageInputSnapshot(
  input: AgentUiImageInputProjectionInput,
): AgentUiImageInputSnapshot {
  const stage = normalizeStage(input.stage ?? undefined);
  const draft = draftImages(input.draft);
  const submitted = submittedImages(input.submittedInput);
  const modelRequest = submittedImages(input.modelRequestInput);
  const restored = draftImages(input.restoredDraft);
  const hydrated = draftImages(input.hydratedUserItems);
  const accepted = acceptedDraftImages(draft);
  const base = {
    stage,
    draftImages: draft,
    submittedImages: submitted,
    modelRequestImages: modelRequest,
    restoredImages: restored,
    hydratedImages: hydrated,
    remoteRejectedUrls: remoteRejectedUrls(input.remoteRejections),
    localDetailStable: localDetailStable(draft, submitted),
    remoteHttpRejected: draft
      .filter((image) => image.kind === "remote")
      .every((image) =>
        remoteRejectedUrls(input.remoteRejections).includes(image.source),
      ),
    dataUrlsAccepted: draft
      .filter((image) => image.kind === "data")
      .every(
        (image) =>
          submitted.some(
            (submittedImage) => submittedImage.source === image.source,
          ) ||
          modelRequest.some(
            (submittedImage) => submittedImage.source === image.source,
          ),
      ),
    restoreStable: restored.length === 0 || sameOrdered(draft, restored),
    hydrateStable:
      hydrated.length === 0 ||
      accepted.every((image) =>
        hydrated.some(
          (hydratedImage) => signature(hydratedImage) === signature(image),
        ),
      ),
    placeholderMapStable:
      restored.length === 0 || samePlaceholders(draft, restored),
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base),
  };
}

function runtimeStatus(
  snapshot: AgentUiImageInputSnapshot,
): AgentUiRuntimeStatus {
  return snapshot.validationIssues.length > 0 ? "failed" : "completed";
}

export function buildLocalRemoteImageInputProjectionEvent(
  input: AgentUiImageInputProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractLocalRemoteImageInputSnapshot(input);
  const status = runtimeStatus(snapshot);
  const base = buildAgentUiProjectionBase(
    { sourceType: "local_remote_image_input_projection" },
    {
      ...context,
      runtimeEntity: "agent_turn",
    },
  );
  return compactProjectionFields({
    ...base,
    type: "messages.snapshot",
    sequence: context.sequence,
    owner: "context",
    scope: "message",
    phase: status === "failed" ? "failed" : "completed",
    surface: "conversation",
    persistence: "snapshot",
    control: "none",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    payload: {
      imageInputEvent: "local_remote_image_input",
      preview: truncateText(
        snapshot.draftImages
          .map((image) => image.placeholder ?? image.source)
          .join("\n"),
      ),
      ...snapshot,
    },
  } satisfies AgentUiProjectionEvent);
}
