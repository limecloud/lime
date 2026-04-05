/**
 * @file 图片生成 Hook
 * @description 管理图片生成状态，复用凭证管理中的 API Key Provider
 * @module components/image-gen/useImageGen
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import {
  importMaterialFromUrl,
  type ImportMaterialFromUrlRequest,
} from "@/lib/api/materials";
import { getImageModelsForProvider } from "@/lib/imageGeneration";
import { isDebugFlagEnabled } from "@/lib/perfDebug";
import { setStoredResourceProjectId } from "@/lib/resourceProjectSelection";
import type {
  GeneratedImage,
  ImageGenRequest,
  ImageGenResponse,
} from "./types";
import { IMAGE_GEN_PROVIDER_IDS } from "./types";

const HISTORY_KEY = "image-gen-history";
const PROVIDER_DEBUG_KEY = "lime:provider-debug";

interface GenerateImageOptions {
  imageCount?: number;
  referenceImages?: string[];
  size?: string;
  targetProjectId?: string;
}

interface EndpointAttemptResult {
  imageUrl: string | null;
  error: string | null;
  assistantText?: string | null;
}

interface EndpointRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface BackfillImagesResult {
  total: number;
  saved: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface SaveImageToResourceResult {
  saved: boolean;
  skipped: boolean;
  error?: string;
}

interface UseImageGenOptions {
  preferredProviderId?: string;
  preferredModelId?: string;
  allowFallback?: boolean;
}

const IMAGE_REQUEST_TIMEOUT_MS = 180_000;
const FAL_DEFAULT_API_HOST = "https://fal.run";
const FAL_QUEUE_API_HOST = "https://queue.fal.run";
const FAL_QUEUE_POLL_INTERVAL_MS = 1500;
const FAL_QUEUE_TIMEOUT_MS = 180_000;
const IMAGE_GEN_MATERIAL_TAG = "image-gen";
const IMAGE_MATERIAL_NAME_MAX_LENGTH = 48;
export const IMAGE_GENERATION_CANCELED_MESSAGE = "已停止当前图片任务";

function imageGenDebugLog(...args: unknown[]): void {
  if (!isDebugFlagEnabled(PROVIDER_DEBUG_KEY)) {
    return;
  }
  console.debug(...args);
}

function sanitizeMaterialName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateForMaterialName(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  const second = `${date.getSeconds()}`.padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function buildGeneratedImageMaterialName(image: GeneratedImage): string {
  const promptHead = sanitizeMaterialName(image.prompt || "").slice(
    0,
    IMAGE_MATERIAL_NAME_MAX_LENGTH,
  );
  const prefix = promptHead || "生成图片";
  const timestamp = formatDateForMaterialName(image.createdAt);
  return `${prefix}-${timestamp}.png`;
}

function buildProviderEndpoint(apiHost: string, endpointPath: string): string {
  const trimmedHost = (apiHost || "").trim().replace(/\/+$/, "");
  const normalizedPath = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;

  if (/\/v\d+$/i.test(trimmedHost) && /^\/v\d+\//i.test(normalizedPath)) {
    return `${trimmedHost}${normalizedPath.replace(/^\/v\d+/i, "")}`;
  }

  return `${trimmedHost}${normalizedPath}`;
}

function ensureHttpProtocol(host: string): string {
  if (/^https?:\/\//i.test(host)) {
    return host;
  }
  return `https://${host}`;
}

function createAbortError(message: string): Error {
  try {
    return new DOMException(message, "AbortError");
  } catch {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      /abort|aborted|cancelled|canceled/i.test(error.message)
    );
  }

  return false;
}

function isGenerationCanceledError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes(IMAGE_GENERATION_CANCELED_MESSAGE);
}

function bindAbortSignal(
  controller: AbortController,
  signal?: AbortSignal,
): () => void {
  if (!signal) {
    return () => undefined;
  }

  if (signal.aborted) {
    controller.abort(
      signal.reason ?? createAbortError(IMAGE_GENERATION_CANCELED_MESSAGE),
    );
    return () => undefined;
  }

  const handleAbort = () => {
    controller.abort(
      signal.reason ?? createAbortError(IMAGE_GENERATION_CANCELED_MESSAGE),
    );
  };

  signal.addEventListener("abort", handleAbort, { once: true });
  return () => signal.removeEventListener("abort", handleAbort);
}

async function fetchWithManagedAbort(
  input: string,
  init: globalThis.RequestInit,
  options?: EndpointRequestOptions,
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 0;
  const abortController = new AbortController();
  const cleanupExternalAbort = bindAbortSignal(
    abortController,
    options?.signal,
  );
  const timeoutHandle =
    timeoutMs > 0
      ? setTimeout(() => {
          abortController.abort(createAbortError("请求超时"));
        }, timeoutMs)
      : null;

  try {
    return await fetch(input, {
      ...init,
      signal: abortController.signal,
    });
  } finally {
    cleanupExternalAbort();
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function attemptFalQueueCancellation(
  cancelUrl: string,
  apiKey: string,
): Promise<void> {
  try {
    const response = await fetchWithManagedAbort(
      cancelUrl,
      {
        method: "PUT",
        headers: {
          Authorization: `Key ${apiKey}`,
        },
      },
      {
        timeoutMs: 10_000,
      },
    );

    if (response.ok || response.status === 404) {
      return;
    }

    const rawText = await response.text();
    console.warn(
      `[ImageGen][fal/queue-cancel] cancel failed: ${response.status} - ${previewResponseText(rawText, 300)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ImageGen][fal/queue-cancel] cancel request failed: ${message}`,
    );
  }
}

function bindFalQueueCancellation(
  cancelUrl: string | undefined,
  apiKey: string,
  signal?: AbortSignal,
): () => void {
  const normalizedCancelUrl = cancelUrl?.trim();
  if (!normalizedCancelUrl || !signal) {
    return () => undefined;
  }

  let cancelRequested = false;
  const requestCancellation = () => {
    if (cancelRequested) {
      return;
    }
    cancelRequested = true;
    void attemptFalQueueCancellation(normalizedCancelUrl, apiKey);
  };

  if (signal.aborted) {
    requestCancellation();
    return () => undefined;
  }

  signal.addEventListener("abort", requestCancellation, { once: true });
  return () => signal.removeEventListener("abort", requestCancellation);
}

function normalizeFalApiHost(apiHost: string): string {
  const trimmed = (apiHost || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return FAL_DEFAULT_API_HOST;
  }
  const normalized = ensureHttpProtocol(trimmed);

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === "fal.run" || parsed.hostname === "queue.fal.run") {
      return `${parsed.protocol}//${parsed.hostname}`;
    }
  } catch {
    // noop
  }

  return normalized;
}

function normalizeFalModel(model: string): string {
  const normalized = (model || "").trim();
  if (!normalized) {
    return "fal-ai/nano-banana-pro";
  }
  return normalized.startsWith("fal-ai/") ? normalized : `fal-ai/${normalized}`;
}

function resolveFalEndpointModelCandidates(
  model: string,
  hasReferenceImages: boolean,
): string[] {
  const endpointModel = normalizeFalModel(model);
  const candidates: string[] = [];
  const pushCandidate = (candidate: string) => {
    const normalized = candidate.trim().replace(/^\/+/, "");
    if (!normalized) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (
    endpointModel.startsWith("fal-ai/bytedance/seedream/v") ||
    endpointModel.startsWith("fal-ai/hunyuan-image/v")
  ) {
    pushCandidate(
      `${endpointModel}/${hasReferenceImages ? "edit" : "text-to-image"}`,
    );
    pushCandidate(endpointModel);
    return candidates;
  }

  if (
    hasReferenceImages &&
    (endpointModel === "fal-ai/nano-banana" ||
      endpointModel === "fal-ai/nano-banana-pro")
  ) {
    pushCandidate(`${endpointModel}/edit`);
    pushCandidate(endpointModel);
    return candidates;
  }

  pushCandidate(endpointModel);
  return candidates;
}

function buildFalEndpoint(apiHost: string, endpointModel: string): string {
  const normalizedHost = normalizeFalApiHost(apiHost).replace(/\/+$/, "");
  return `${normalizedHost}/${endpointModel.replace(/^\/+/, "")}`;
}

function resolveFalQueueHost(apiHost: string): string {
  const normalized = normalizeFalApiHost(apiHost);

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === "queue.fal.run") {
      return `${parsed.protocol}//${parsed.hostname}`;
    }
    if (parsed.hostname === "fal.run") {
      return `${parsed.protocol}//queue.fal.run`;
    }
  } catch {
    // noop
  }

  return FAL_QUEUE_API_HOST;
}

function normalizeReferenceImages(referenceImages: string[]): string[] {
  return referenceImages
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function stripFalEndpointSuffix(model: string): string {
  return normalizeFalModel(model).replace(
    /(\/(?:edit|text-to-image|text_to_image))$/i,
    "",
  );
}

function isFalNanoBananaModel(model: string): boolean {
  const normalized = stripFalEndpointSuffix(model);
  return (
    normalized === "fal-ai/nano-banana" ||
    normalized === "fal-ai/nano-banana-pro"
  );
}

function isFalNanoBananaEditEndpoint(endpointModel: string): boolean {
  const normalized = normalizeFalModel(endpointModel);
  return /\/edit$/i.test(normalized);
}

function buildFalInput(
  prompt: string,
  referenceImages: string[],
  size: string,
  endpointModel: string,
  includeOptionalFields = true,
): Record<string, unknown> {
  const cleanedReferences = normalizeReferenceImages(referenceImages);
  const normalizedPrompt = (() => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return trimmedPrompt;
    }

    if (isFalNanoBananaModel(endpointModel) && trimmedPrompt.length < 3) {
      return cleanedReferences.length > 0
        ? `请基于参考图围绕“${trimmedPrompt}”完成图像编辑`
        : `请围绕“${trimmedPrompt}”生成一张图像`;
    }

    return trimmedPrompt;
  })();
  const input: Record<string, unknown> = {
    prompt: normalizedPrompt,
    num_images: 1,
  };

  if (isFalNanoBananaModel(endpointModel)) {
    if (
      cleanedReferences.length > 0 &&
      isFalNanoBananaEditEndpoint(endpointModel)
    ) {
      input.image_urls = cleanedReferences;
    }

    const aspectRatio = sizeToAspectRatio(size);
    if (aspectRatio) {
      input.aspect_ratio = aspectRatio;
    }

    input.output_format = "png";
    input.safety_tolerance = "4";
    return input;
  }

  if (cleanedReferences.length > 0) {
    input.image_urls = cleanedReferences;
    input.image_url = cleanedReferences[0];
  }

  if (!includeOptionalFields) {
    return input;
  }

  input.enable_safety_checker = false;

  const matchedSize = size.match(/^(\d+)x(\d+)$/i);
  if (matchedSize) {
    const width = Number.parseInt(matchedSize[1], 10);
    const height = Number.parseInt(matchedSize[2], 10);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      input.image_size = { width, height };
    }
  }

  const aspectRatio = sizeToAspectRatio(size);
  if (aspectRatio) {
    input.aspect_ratio = aspectRatio;
  }

  return input;
}

function resolveFalQueueResponseEndpoint(candidate: string): string {
  const normalized = candidate.trim().replace(/\/+$/, "");
  if (!normalized) {
    return normalized;
  }

  if (/\/response(?:\?.*)?$/i.test(normalized)) {
    return normalized;
  }

  if (/\/status(?:\/stream)?(?:\?.*)?$/i.test(normalized)) {
    return normalized.replace(/\/status(?:\/stream)?(?:\?.*)?$/i, "/response");
  }

  return `${normalized}/response`;
}

function buildFalQueueResultCandidates(
  responseUrl?: string,
  statusUrl?: string,
  fallbackRequestBase?: string,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (candidate?: string) => {
    const normalized = candidate?.trim();
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  if (responseUrl) {
    pushCandidate(responseUrl);
    pushCandidate(resolveFalQueueResponseEndpoint(responseUrl));
  }

  if (statusUrl) {
    const legacyBase = statusUrl.replace(
      /\/status(?:\/stream)?(?:\?.*)?$/i,
      "",
    );
    pushCandidate(resolveFalQueueResponseEndpoint(statusUrl));
    pushCandidate(legacyBase);
  }

  if (fallbackRequestBase) {
    pushCandidate(resolveFalQueueResponseEndpoint(fallbackRequestBase));
    pushCandidate(fallbackRequestBase);
  }

  return candidates;
}

interface FalQueueResultFetch {
  imageUrl: string | null;
  error: string | null;
  pending: boolean;
}

async function fetchFalQueueResult(
  endpoint: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FalQueueResultFetch> {
  let response: Response;
  try {
    response = await fetchWithManagedAbort(
      endpoint,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
        },
      },
      {
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted && isAbortLikeError(error)) {
      throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      imageUrl: null,
      error: `Fal 队列结果获取异常: ${message}`,
      pending: false,
    };
  }

  const rawText = await response.text();
  const payload = tryParseJson(rawText) as Record<string, unknown> | null;
  const statusText =
    typeof payload?.status === "string" ? payload.status.toUpperCase() : "";
  const errorText =
    typeof payload?.error === "string" ? payload.error.trim() : "";

  if (statusText === "COMPLETED" && errorText) {
    return {
      imageUrl: null,
      error: `Fal 队列任务失败: ${errorText}`,
      pending: false,
    };
  }

  if (
    statusText === "FAILED" ||
    statusText === "ERROR" ||
    statusText === "CANCELLED"
  ) {
    return {
      imageUrl: null,
      error: `Fal 队列任务失败: ${errorText || previewResponseText(rawText, 300) || statusText}`,
      pending: false,
    };
  }

  if (
    response.status === 202 ||
    statusText === "IN_QUEUE" ||
    statusText === "IN_PROGRESS"
  ) {
    return {
      imageUrl: null,
      error: null,
      pending: true,
    };
  }

  if (!response.ok) {
    return {
      imageUrl: null,
      error: `Fal 队列结果获取失败: ${response.status} - ${previewResponseText(rawText, 300)}`,
      pending: false,
    };
  }

  const imageUrl = payload
    ? extractImageUrlFromPayload(payload)
    : extractImageUrlFromText(rawText);

  if (imageUrl) {
    return {
      imageUrl,
      error: null,
      pending: false,
    };
  }

  return {
    imageUrl: null,
    error: "Fal 队列结果中未找到图片地址",
    pending: false,
  };
}

function summarizeImageGenerationErrors(errors: string[]): string {
  const normalizedErrors = Array.from(
    new Set(errors.map((item) => item.trim()).filter(Boolean)),
  );

  if (normalizedErrors.length === 0) {
    return "图片生成失败";
  }

  if (normalizedErrors.length === 1) {
    return normalizedErrors[0];
  }

  const preview = normalizedErrors.slice(0, 3).join("；");
  const suffix =
    normalizedErrors.length > 3
      ? `；另有 ${normalizedErrors.length - 3} 条错误`
      : "";
  return `全部图片生成失败：${preview}${suffix}`;
}

function wrapBase64AsDataUrl(value: string): string {
  if (value.startsWith("data:image/")) {
    return value;
  }
  return `data:image/png;base64,${value}`;
}

function looksLikeBase64Data(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 128) {
    return false;
  }
  return /^[A-Za-z0-9+/=\n\r]+$/.test(normalized);
}

function normalizeImageUrl(endpoint: string, candidate: string): string {
  const value = candidate.trim();

  if (!value) {
    return value;
  }

  if (value.startsWith("data:image/")) {
    return value;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (looksLikeBase64Data(value)) {
    return wrapBase64AsDataUrl(value.replace(/\s+/g, ""));
  }

  try {
    const endpointUrl = new URL(endpoint);

    if (value.startsWith("//")) {
      return `${endpointUrl.protocol}${value}`;
    }

    if (value.startsWith("/")) {
      return `${endpointUrl.origin}${value}`;
    }

    if (value.startsWith("images/") || value.startsWith("v1/")) {
      return `${endpointUrl.origin}/${value.replace(/^\/+/, "")}`;
    }
  } catch {
    return value;
  }

  return value;
}

function previewResponseText(text: string, maxLength = 600): string {
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

function tryParseJson(text: string): unknown | null {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function looksLikeRelativeImagePath(value: string): boolean {
  return (
    /^\/?[^\s"'`<>]+\.(png|jpe?g|gif|webp|bmp|svg)(\?[^\s"'`<>]*)?$/i.test(
      value,
    ) || /^\/?(v\d+\/)?(images?|files?|uploads?)\/[^\s"'`<>]+$/i.test(value)
  );
}

function extractDirectImageCandidate(value: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:image/")
  ) {
    return normalized;
  }

  if (looksLikeBase64Data(normalized)) {
    return wrapBase64AsDataUrl(normalized.replace(/\s+/g, ""));
  }

  if (looksLikeRelativeImagePath(normalized)) {
    return normalized;
  }

  if (/^\/[^\s]+$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function computeGreatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);

  while (right !== 0) {
    const temp = right;
    right = left % right;
    left = temp;
  }

  return left || 1;
}

function sizeToAspectRatio(size: string): string | null {
  const matched = size.match(/^(\d+)x(\d+)$/i);
  if (!matched) {
    return null;
  }

  const width = Number.parseInt(matched[1], 10);
  const height = Number.parseInt(matched[2], 10);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const gcd = computeGreatestCommonDivisor(width, height);
  const exactRatio = `${Math.round(width / gcd)}:${Math.round(height / gcd)}`;
  const supportedAspectRatios = [
    ["21:9", 21 / 9],
    ["16:9", 16 / 9],
    ["3:2", 3 / 2],
    ["4:3", 4 / 3],
    ["5:4", 5 / 4],
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["3:4", 3 / 4],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
  ] as const;

  if (supportedAspectRatios.some(([label]) => label === exactRatio)) {
    return exactRatio;
  }

  const numericRatio = width / height;
  const nearest = supportedAspectRatios.reduce<
    readonly [string, number] | null
  >((best, current) => {
    if (!best) {
      return current;
    }

    const bestDiff = Math.abs(numericRatio - best[1]);
    const currentDiff = Math.abs(numericRatio - current[1]);
    return currentDiff < bestDiff ? current : best;
  }, null);

  if (!nearest) {
    return null;
  }

  return Math.abs(numericRatio - nearest[1]) <= 0.08 ? nearest[0] : "auto";
}

function collectTextFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFromUnknown(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const texts: string[] = [];

    if (typeof record.text === "string") {
      texts.push(record.text.trim());
    }

    if (typeof record.content === "string") {
      texts.push(record.content.trim());
    }

    if (record.parts) {
      texts.push(...collectTextFromUnknown(record.parts));
    }

    return texts.filter(Boolean);
  }

  return [];
}

function extractAssistantTextFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  const choicesValue = record.choices;
  if (Array.isArray(choicesValue) && choicesValue.length > 0) {
    const firstChoice = choicesValue[0];
    if (firstChoice && typeof firstChoice === "object") {
      const choiceRecord = firstChoice as Record<string, unknown>;
      const messageValue = choiceRecord.message;
      if (messageValue && typeof messageValue === "object") {
        const messageRecord = messageValue as Record<string, unknown>;
        const contentTexts = collectTextFromUnknown(messageRecord.content);
        if (contentTexts.length > 0) {
          return contentTexts.join("\n");
        }
      }

      const deltaValue = choiceRecord.delta;
      if (deltaValue && typeof deltaValue === "object") {
        const deltaRecord = deltaValue as Record<string, unknown>;
        const deltaTexts = collectTextFromUnknown(deltaRecord.content);
        if (deltaTexts.length > 0) {
          return deltaTexts.join("\n");
        }
      }
    }
  }

  const outputText = record.output_text;
  if (typeof outputText === "string" && outputText.trim().length > 0) {
    return outputText.trim();
  }

  const candidatesValue = record.candidates;
  if (Array.isArray(candidatesValue) && candidatesValue.length > 0) {
    const candidateTexts = collectTextFromUnknown(candidatesValue[0]);
    if (candidateTexts.length > 0) {
      return candidateTexts.join("\n");
    }
  }

  const contentTexts = collectTextFromUnknown(record.content);
  if (contentTexts.length > 0) {
    return contentTexts.join("\n");
  }

  return null;
}

function shouldAutoConfirmChat(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }

  const normalized = stripCodeFence(text);
  return (
    /确认继续|是否继续|要继续吗|你觉得怎么样|是否确认/i.test(normalized) ||
    /不支持.*比例|建议使用.*比例|已支持的比例/i.test(normalized)
  );
}

async function requestImageWithEndpoint(
  endpoint: string,
  payload: Record<string, unknown>,
  apiKey: string,
  logTag: string,
  options?: EndpointRequestOptions,
): Promise<EndpointAttemptResult> {
  const timeoutMs = options?.timeoutMs ?? IMAGE_REQUEST_TIMEOUT_MS;
  let response: Response;

  try {
    response = await fetchWithManagedAbort(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      {
        timeoutMs,
        signal: options?.signal,
      },
    );
  } catch (error) {
    if (options?.signal?.aborted && isAbortLikeError(error)) {
      throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
    }

    const rawErrorMessage =
      error instanceof Error ? error.message : String(error);
    const loweredMessage = rawErrorMessage.toLowerCase();
    const isTimeoutLike =
      (error instanceof DOMException && error.name === "AbortError") ||
      loweredMessage.includes("timed out") ||
      loweredMessage.includes("timeout") ||
      loweredMessage.includes("load failed") ||
      loweredMessage.includes("networkerror");

    console.warn(
      `[ImageGen][${logTag}] request failed: endpoint=${endpoint}, timeoutMs=${timeoutMs}, error=${rawErrorMessage}`,
    );

    return {
      imageUrl: null,
      error: isTimeoutLike
        ? `请求超时或网络错误: ${rawErrorMessage}`
        : `请求异常: ${rawErrorMessage}`,
      assistantText: null,
    };
  }

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  const parsedJson = tryParseJson(rawText);

  console.log(
    `[ImageGen][${logTag}] endpoint=${endpoint}, status=${response.status}, content-type=${contentType}`,
  );

  if (parsedJson && typeof parsedJson === "object") {
    const parsedRecord = parsedJson as Record<string, unknown>;

    console.log(
      `[ImageGen][${logTag}] response keys:`,
      Object.keys(parsedRecord),
    );

    const choicesValue = parsedRecord.choices;
    if (Array.isArray(choicesValue) && choicesValue.length > 0) {
      const firstChoice = choicesValue[0];
      if (firstChoice && typeof firstChoice === "object") {
        const firstChoiceRecord = firstChoice as Record<string, unknown>;
        const messageValue = firstChoiceRecord.message;
        if (messageValue && typeof messageValue === "object") {
          const messageRecord = messageValue as Record<string, unknown>;
          const contentValue = messageRecord.content;

          if (typeof contentValue === "string") {
            console.log(
              `[ImageGen][${logTag}] first choice content preview:`,
              previewResponseText(contentValue, 300),
            );
          } else if (Array.isArray(contentValue)) {
            const firstItem = contentValue[0];
            const firstItemKeys =
              firstItem && typeof firstItem === "object"
                ? Object.keys(firstItem as Record<string, unknown>)
                : [];

            console.log(
              `[ImageGen][${logTag}] first choice content array: length=${contentValue.length}, firstItemKeys=${firstItemKeys.join(",") || "none"}`,
            );

            if (typeof firstItem === "string") {
              console.log(
                `[ImageGen][${logTag}] first choice first item preview:`,
                previewResponseText(firstItem, 200),
              );
            } else if (firstItem && typeof firstItem === "object") {
              const firstItemText = (firstItem as Record<string, unknown>).text;
              if (typeof firstItemText === "string") {
                console.log(
                  `[ImageGen][${logTag}] first choice first item text preview:`,
                  previewResponseText(firstItemText, 200),
                );
              }
            }
          } else if (contentValue !== undefined) {
            console.log(
              `[ImageGen][${logTag}] first choice content type:`,
              typeof contentValue,
            );
          }
        }
      }
    }

    const outputValue = parsedRecord.output;
    if (Array.isArray(outputValue) && outputValue.length > 0) {
      const firstOutput = outputValue[0];
      if (firstOutput && typeof firstOutput === "object") {
        console.log(
          `[ImageGen][${logTag}] first output keys:`,
          Object.keys(firstOutput as Record<string, unknown>),
        );
      }
    }
  } else {
    console.log(
      `[ImageGen][${logTag}] response preview:`,
      previewResponseText(rawText),
    );
  }

  const assistantText = extractAssistantTextFromPayload(parsedJson);

  if (assistantText) {
    console.log(
      `[ImageGen][${logTag}] assistant text preview:`,
      previewResponseText(stripCodeFence(assistantText), 260),
    );
  }

  if (!response.ok) {
    return {
      imageUrl: null,
      error: `请求失败: ${response.status} - ${previewResponseText(rawText, 300)}`,
      assistantText,
    };
  }

  const imageUrl = parsedJson
    ? extractImageUrlFromPayload(parsedJson)
    : extractImageUrlFromText(rawText);

  if (!imageUrl) {
    return {
      imageUrl: null,
      error: "未能从响应中提取图片",
      assistantText,
    };
  }

  const normalizedImageUrl = normalizeImageUrl(endpoint, imageUrl);

  return {
    imageUrl: normalizedImageUrl,
    error: null,
    assistantText,
  };
}

function extractImageUrlFromText(content: string): string | null {
  if (!content) {
    return null;
  }

  const normalizedContent = stripCodeFence(content);

  const directCandidate = extractDirectImageCandidate(normalizedContent);
  if (directCandidate) {
    return directCandidate;
  }

  const base64MarkdownMatch = normalizedContent.match(
    /!\[.*?\]\((data:image\/[^;]+;base64,[^)]+)\)/,
  );
  if (base64MarkdownMatch) {
    return base64MarkdownMatch[1];
  }

  const markdownMatch = normalizedContent.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (markdownMatch) {
    const markdownValue = markdownMatch[1]
      .trim()
      .replace(/^<|>$/g, "")
      .split(/\s+/)[0];
    const markdownCandidate = extractDirectImageCandidate(markdownValue);
    if (markdownCandidate) {
      return markdownCandidate;
    }
    return markdownValue;
  }

  const dataUriMatch = normalizedContent.match(
    /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/,
  );
  if (dataUriMatch) {
    return dataUriMatch[0];
  }

  const plainUrlMatch = normalizedContent.match(/https?:\/\/[^\s"'`<>]+/);
  if (plainUrlMatch) {
    return plainUrlMatch[0];
  }

  const quotedFieldMatch = normalizedContent.match(
    /"(?:url|uri|link|image_url|imageUrl|path|image_path|imagePath|download_url|downloadUrl|file|file_url|fileUrl)"\s*:\s*"([^"]+)"/i,
  );
  if (quotedFieldMatch) {
    const quotedCandidate = extractDirectImageCandidate(quotedFieldMatch[1]);
    if (quotedCandidate) {
      return quotedCandidate;
    }
    return quotedFieldMatch[1];
  }

  const relativePathMatch = normalizedContent.match(
    /(?:^|["'(\s])((?:\/|\.\/)?(?:v\d+\/)?(?:images?|files?|uploads?)\/[^\s"'`<>)]+)(?=$|["')\s])/i,
  );
  if (relativePathMatch) {
    return relativePathMatch[1];
  }

  if (looksLikeBase64Data(normalizedContent)) {
    return wrapBase64AsDataUrl(normalizedContent.replace(/\s+/g, ""));
  }

  const parsed = tryParseJson(normalizedContent);
  if (parsed) {
    return extractImageUrlFromPayload(parsed);
  }

  const jsonBlockMatch = normalizedContent.match(/\{[\s\S]+\}/);
  if (jsonBlockMatch) {
    const nestedParsed = tryParseJson(jsonBlockMatch[0]);
    if (nestedParsed) {
      return extractImageUrlFromPayload(nestedParsed);
    }
  }

  return null;
}

function extractImageUrlFromPayload(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    return extractImageUrlFromText(payload);
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = extractImageUrlFromPayload(item);
      if (extracted) {
        return extracted;
      }
    }
    return null;
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    const inlineDataValue = record.inline_data || record.inlineData;
    if (inlineDataValue && typeof inlineDataValue === "object") {
      const inlineDataRecord = inlineDataValue as Record<string, unknown>;
      const inlineBase64 = inlineDataRecord.data;
      if (typeof inlineBase64 === "string" && inlineBase64.trim().length > 0) {
        const mime =
          typeof inlineDataRecord.mime_type === "string"
            ? inlineDataRecord.mime_type
            : typeof inlineDataRecord.mimeType === "string"
              ? inlineDataRecord.mimeType
              : "image/png";
        if (inlineBase64.startsWith("data:image/")) {
          return inlineBase64;
        }
        return `data:${mime};base64,${inlineBase64.replace(/\s+/g, "")}`;
      }
    }

    const fileDataValue = record.file_data || record.fileData;
    if (fileDataValue && typeof fileDataValue === "object") {
      const fileDataRecord = fileDataValue as Record<string, unknown>;
      const fileUri = fileDataRecord.file_uri || fileDataRecord.fileUri;
      if (typeof fileUri === "string" && fileUri.trim().length > 0) {
        return fileUri.trim();
      }
    }

    const base64Keys = [
      "b64_json",
      "image_base64",
      "base64",
      "b64",
      "image_b64",
    ];

    for (const key of base64Keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        if (value.startsWith("data:image/")) {
          return value;
        }

        if (
          looksLikeBase64Data(value) ||
          key.includes("b64") ||
          key.includes("base64")
        ) {
          return wrapBase64AsDataUrl(value.replace(/\s+/g, ""));
        }
      }
    }

    const directKeys = [
      "url",
      "uri",
      "link",
      "href",
      "image",
      "image_url",
      "imageUrl",
      "image_uri",
      "imageUri",
      "path",
      "image_path",
      "imagePath",
      "download_url",
      "downloadUrl",
      "file",
      "file_url",
      "fileUrl",
    ];

    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string") {
        const directCandidate = extractDirectImageCandidate(value);
        if (directCandidate) {
          return directCandidate;
        }

        const extractedFromText = extractImageUrlFromText(value);
        if (extractedFromText) {
          return extractedFromText;
        }
      }

      if (value && typeof value === "object") {
        const nestedCandidate = extractImageUrlFromPayload(value);
        if (nestedCandidate) {
          return nestedCandidate;
        }
      }
    }

    const directUrl = record.url;
    if (typeof directUrl === "string") {
      return directUrl;
    }

    const imageUrl = record.image_url;
    if (typeof imageUrl === "string") {
      return imageUrl;
    }
    if (imageUrl && typeof imageUrl === "object") {
      const nestedUrl = (imageUrl as Record<string, unknown>).url;
      if (typeof nestedUrl === "string") {
        return nestedUrl;
      }
    }

    const b64Json = record.b64_json;
    if (typeof b64Json === "string" && b64Json.length > 0) {
      return wrapBase64AsDataUrl(b64Json);
    }

    const imageBase64 = record.image_base64;
    if (typeof imageBase64 === "string" && imageBase64.length > 0) {
      return wrapBase64AsDataUrl(imageBase64);
    }

    const base64 = record.base64;
    if (typeof base64 === "string" && base64.length > 0) {
      return wrapBase64AsDataUrl(base64);
    }

    const messageValue = record.message;
    if (messageValue && typeof messageValue === "object") {
      const messageRecord = messageValue as Record<string, unknown>;
      const messageContent = messageRecord.content;

      if (typeof messageContent === "string") {
        const fromMessageText = extractImageUrlFromText(messageContent);
        if (fromMessageText) {
          return fromMessageText;
        }
      }

      if (Array.isArray(messageContent)) {
        for (const item of messageContent) {
          const fromMessageItem = extractImageUrlFromPayload(item);
          if (fromMessageItem) {
            return fromMessageItem;
          }
        }
      }
    }

    const contentValue = record.content;
    if (typeof contentValue === "string") {
      const fromContent = extractImageUrlFromText(contentValue);
      if (fromContent) {
        return fromContent;
      }
    }

    if (Array.isArray(contentValue)) {
      for (const item of contentValue) {
        const fromContentItem = extractImageUrlFromPayload(item);
        if (fromContentItem) {
          return fromContentItem;
        }
      }
    }

    const outputTextValue = record.output_text;
    if (typeof outputTextValue === "string") {
      const fromOutputText = extractImageUrlFromText(outputTextValue);
      if (fromOutputText) {
        return fromOutputText;
      }
    }

    const outputValue = record.output;
    if (Array.isArray(outputValue)) {
      for (const outputItem of outputValue) {
        const fromOutput = extractImageUrlFromPayload(outputItem);
        if (fromOutput) {
          return fromOutput;
        }
      }
    }

    for (const value of Object.values(record)) {
      const extracted = extractImageUrlFromPayload(value);
      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
}

async function requestImageFromNewApi(
  apiHost: string,
  apiKey: string,
  model: string,
  prompt: string,
  referenceImages: string[],
  size: string,
  signal?: AbortSignal,
): Promise<string> {
  const referenceText =
    referenceImages.length > 0
      ? `\n参考图链接：\n${referenceImages
          .map((url, index) => `${index + 1}. ${url}`)
          .join("\n")}`
      : "";

  const imagesRequest = {
    model,
    prompt: `${prompt}${referenceText}`,
    n: 1,
    size,
  };

  const imageEndpoint = buildProviderEndpoint(
    apiHost,
    "/v1/images/generations",
  );
  const imageAttempt = await requestImageWithEndpoint(
    imageEndpoint,
    imagesRequest,
    apiKey,
    "new-api/images",
    { signal },
  );

  if (imageAttempt.imageUrl) {
    return imageAttempt.imageUrl;
  }

  console.warn(
    `[ImageGen][new-api/images] failed, fallback to chat: ${imageAttempt.error || "unknown"}`,
  );

  const chatRequest = {
    model,
    messages: [
      {
        role: "user",
        content:
          "请根据以下描述生成一张图片，并以 Markdown 图片格式返回结果。" +
          "\n要求：不要询问是否继续，不要额外解释。若比例不支持，请自动选择最接近的支持比例并直接生成。" +
          (() => {
            const preferredAspectRatio = sizeToAspectRatio(size);
            return preferredAspectRatio
              ? `\n目标分辨率：${size}（优先比例 ${preferredAspectRatio}）`
              : `\n目标分辨率：${size}`;
          })() +
          `\n描述：${prompt}${referenceText}`,
      },
    ],
    temperature: 0.7,
    stream: false,
  };

  const chatEndpoint = buildProviderEndpoint(apiHost, "/v1/chat/completions");
  const chatAttempt = await requestImageWithEndpoint(
    chatEndpoint,
    chatRequest,
    apiKey,
    "new-api/chat",
    { signal },
  );

  if (chatAttempt.imageUrl) {
    return chatAttempt.imageUrl;
  }

  console.warn(
    `[ImageGen][new-api/chat] failed, continue fallback: ${chatAttempt.error || "unknown"}`,
  );

  let chatRetryAttempt: EndpointAttemptResult | null = null;
  if (shouldAutoConfirmChat(chatAttempt.assistantText)) {
    const preferredAspectRatio = sizeToAspectRatio(size);
    const retryMessages: Array<{
      role: "user" | "assistant";
      content: string;
    }> = [
      {
        role: "user",
        content:
          "请直接生成图片，不要询问确认。" +
          (preferredAspectRatio
            ? `\n可优先使用比例：${preferredAspectRatio}`
            : "\n可优先使用最接近可用比例") +
          `\n描述：${prompt}${referenceText}`,
      },
    ];

    if (chatAttempt.assistantText) {
      retryMessages.push({
        role: "assistant",
        content: stripCodeFence(chatAttempt.assistantText),
      });
    }

    retryMessages.push({
      role: "user",
      content:
        "确认继续。请按你建议的可用比例立即生成图片。" +
        "\n只返回 Markdown 图片，不要任何额外文字。",
    });

    chatRetryAttempt = await requestImageWithEndpoint(
      chatEndpoint,
      {
        model,
        messages: retryMessages,
        temperature: 0.7,
        stream: false,
      },
      apiKey,
      "new-api/chat-retry",
      { signal },
    );

    if (chatRetryAttempt.imageUrl) {
      return chatRetryAttempt.imageUrl;
    }

    console.warn(
      `[ImageGen][new-api/chat-retry] failed, fallback to responses: ${chatRetryAttempt.error || "unknown"}`,
    );
  }

  const responsesRequest = {
    model,
    input: `请根据以下描述生成一张图片，仅返回图片结果。\n描述：${prompt}${referenceText}`,
    tools: [{ type: "image_generation" }],
    size,
  };

  const responsesEndpoint = buildProviderEndpoint(apiHost, "/v1/responses");
  const responsesAttempt = await requestImageWithEndpoint(
    responsesEndpoint,
    responsesRequest,
    apiKey,
    "new-api/responses",
    { signal },
  );

  if (responsesAttempt.imageUrl) {
    return responsesAttempt.imageUrl;
  }

  console.warn(
    `[ImageGen][new-api/responses] failed, fallback to gemini-native: ${responsesAttempt.error || "unknown"}`,
  );

  const geminiNativeRequest = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "请根据以下描述生成图片，仅返回图片数据。" +
              (() => {
                const preferredAspectRatio = sizeToAspectRatio(size);
                return preferredAspectRatio
                  ? `\n优先比例：${preferredAspectRatio}`
                  : "";
              })() +
              `\n描述：${prompt}${referenceText}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  const geminiNativeEndpoint = buildProviderEndpoint(
    apiHost,
    `/v1beta/models/${model}:generateContent`,
  );

  const geminiNativeAttempt = await requestImageWithEndpoint(
    geminiNativeEndpoint,
    geminiNativeRequest,
    apiKey,
    "new-api/gemini-native",
    { signal },
  );

  if (geminiNativeAttempt.imageUrl) {
    return geminiNativeAttempt.imageUrl;
  }

  throw new Error(
    `未能从响应中提取图片，请检查服务商返回格式（images: ${imageAttempt.error || "未知"}; chat: ${chatAttempt.error || "未知"}; chat-retry: ${chatRetryAttempt?.error || "未触发"}; responses: ${responsesAttempt.error || "未知"}; gemini-native: ${geminiNativeAttempt.error || "未知"}）`,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(IMAGE_GENERATION_CANCELED_MESSAGE));
      return;
    }

    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", handleAbort);
      reject(createAbortError(IMAGE_GENERATION_CANCELED_MESSAGE));
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function requestImageFromFalEndpoint(
  endpoint: string,
  payload: Record<string, unknown>,
  apiKey: string,
  logTag: string,
  timeoutMs = IMAGE_REQUEST_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<EndpointAttemptResult> {
  let response: Response;
  try {
    response = await fetchWithManagedAbort(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      {
        timeoutMs,
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted && isAbortLikeError(error)) {
      throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      imageUrl: null,
      error: `请求异常: ${message}`,
    };
  }

  const rawText = await response.text();
  const parsedJson = tryParseJson(rawText);

  console.log(
    `[ImageGen][${logTag}] endpoint=${endpoint}, status=${response.status}`,
  );

  if (!response.ok) {
    return {
      imageUrl: null,
      error: `请求失败: ${response.status} - ${previewResponseText(rawText, 300)}`,
    };
  }

  const imageUrl = parsedJson
    ? extractImageUrlFromPayload(parsedJson)
    : extractImageUrlFromText(rawText);

  if (!imageUrl) {
    return {
      imageUrl: null,
      error: "未能从 Fal 响应中提取图片",
    };
  }

  return {
    imageUrl: normalizeImageUrl(endpoint, imageUrl),
    error: null,
  };
}

async function requestImageFromFalQueue(
  apiHost: string,
  endpointModel: string,
  payload: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const queueHost = resolveFalQueueHost(apiHost).replace(/\/+$/, "");
  const normalizedModel = endpointModel.replace(/^\/+/, "");
  const submitEndpoint = `${queueHost}/${normalizedModel}`;
  let fallbackRequestBase = "";

  const submitResponse = await fetchWithManagedAbort(
    submitEndpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
      signal,
    },
  );

  const submitRaw = await submitResponse.text();
  const submitPayload = tryParseJson(submitRaw) as Record<
    string,
    unknown
  > | null;

  if (!submitResponse.ok) {
    throw new Error(
      `Fal 队列提交失败: ${submitResponse.status} - ${previewResponseText(submitRaw, 300)}`,
    );
  }

  const requestId =
    typeof submitPayload?.request_id === "string"
      ? submitPayload.request_id
      : undefined;
  let statusUrl =
    typeof submitPayload?.status_url === "string"
      ? submitPayload.status_url
      : undefined;
  let responseUrl =
    typeof submitPayload?.response_url === "string"
      ? submitPayload.response_url
      : undefined;
  let cancelUrl =
    typeof submitPayload?.cancel_url === "string"
      ? submitPayload.cancel_url
      : undefined;

  if (requestId) {
    fallbackRequestBase = `${queueHost}/${normalizedModel}/requests/${encodeURIComponent(requestId)}`;
    if (!statusUrl) {
      statusUrl = `${fallbackRequestBase}/status`;
    }
    if (!responseUrl) {
      responseUrl = resolveFalQueueResponseEndpoint(fallbackRequestBase);
    }
    if (!cancelUrl) {
      cancelUrl = `${fallbackRequestBase}/cancel`;
    }
  }

  if (!statusUrl && !responseUrl) {
    throw new Error("Fal 队列提交成功，但返回中缺少状态查询地址");
  }

  const cleanupQueueCancellation = bindFalQueueCancellation(
    cancelUrl,
    apiKey,
    signal,
  );

  try {
    const startedAt = Date.now();
    let queueStatus = "";

    while (Date.now() - startedAt < FAL_QUEUE_TIMEOUT_MS) {
      if (statusUrl) {
        const statusResponse = await fetchWithManagedAbort(
          statusUrl,
          {
            headers: {
              Authorization: `Key ${apiKey}`,
            },
          },
          {
            timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
            signal,
          },
        );
        const statusRaw = await statusResponse.text();
        const statusPayload = tryParseJson(statusRaw) as Record<
          string,
          unknown
        > | null;

        if (!statusResponse.ok) {
          throw new Error(
            `Fal 队列状态查询失败: ${statusResponse.status} - ${previewResponseText(statusRaw, 300)}`,
          );
        }

        if (typeof statusPayload?.response_url === "string") {
          responseUrl = statusPayload.response_url;
        }

        queueStatus =
          typeof statusPayload?.status === "string"
            ? statusPayload.status.toUpperCase()
            : "";

        const queueError =
          typeof statusPayload?.error === "string"
            ? statusPayload.error.trim()
            : "";

        if (queueStatus === "COMPLETED" && queueError) {
          throw new Error(`Fal 队列任务失败: ${queueError}`);
        }

        if (queueStatus === "COMPLETED") {
          break;
        }

        if (
          queueStatus === "FAILED" ||
          queueStatus === "ERROR" ||
          queueStatus === "CANCELLED"
        ) {
          const detail =
            typeof statusPayload?.error === "string"
              ? statusPayload.error
              : previewResponseText(statusRaw, 200);
          throw new Error(`Fal 队列任务失败: ${detail || queueStatus}`);
        }
      } else if (responseUrl) {
        const pollingResult = await fetchFalQueueResult(
          responseUrl,
          apiKey,
          signal,
        );
        if (pollingResult.imageUrl) {
          return normalizeImageUrl(responseUrl, pollingResult.imageUrl);
        }
        if (!pollingResult.pending && pollingResult.error) {
          throw new Error(pollingResult.error);
        }
      }

      await sleep(FAL_QUEUE_POLL_INTERVAL_MS, signal);
    }

    if (Date.now() - startedAt >= FAL_QUEUE_TIMEOUT_MS) {
      throw new Error("Fal 队列任务超时，请稍后重试");
    }

    const finalCandidates = buildFalQueueResultCandidates(
      responseUrl,
      statusUrl,
      fallbackRequestBase || undefined,
    );

    if (finalCandidates.length === 0) {
      throw new Error("Fal 队列任务完成后未返回结果地址");
    }

    const resultErrors: string[] = [];
    for (const endpoint of finalCandidates) {
      const result = await fetchFalQueueResult(endpoint, apiKey, signal);
      if (result.imageUrl) {
        return normalizeImageUrl(endpoint, result.imageUrl);
      }
      if (result.pending) {
        resultErrors.push(`${endpoint}: 结果尚未就绪`);
        continue;
      }
      if (result.error) {
        resultErrors.push(`${endpoint}: ${result.error}`);
      }
    }

    if (resultErrors.length > 0) {
      throw new Error(resultErrors.join("; "));
    }

    throw new Error("Fal 队列结果中未找到图片地址");
  } finally {
    cleanupQueueCancellation();
  }
}

async function requestImageFromFal(
  apiHost: string,
  apiKey: string,
  model: string,
  prompt: string,
  referenceImages: string[],
  size: string,
  signal?: AbortSignal,
): Promise<string> {
  const cleanedReferences = normalizeReferenceImages(referenceImages);
  const endpointModels = resolveFalEndpointModelCandidates(
    model,
    cleanedReferences.length > 0,
  );
  const errors: string[] = [];

  for (const endpointModel of endpointModels) {
    const primaryInput = buildFalInput(
      prompt,
      cleanedReferences,
      size,
      endpointModel,
      true,
    );
    const compactInput = buildFalInput(
      prompt,
      cleanedReferences,
      size,
      endpointModel,
      false,
    );
    const shouldTryCompact =
      JSON.stringify(primaryInput) !== JSON.stringify(compactInput);
    const endpoint = buildFalEndpoint(apiHost, endpointModel);
    const primaryAttempt = await requestImageFromFalEndpoint(
      endpoint,
      primaryInput,
      apiKey,
      `fal/sync-primary/${endpointModel}`,
      IMAGE_REQUEST_TIMEOUT_MS,
      signal,
    );

    if (primaryAttempt.imageUrl) {
      return primaryAttempt.imageUrl;
    }

    if (primaryAttempt.error) {
      errors.push(`${endpointModel}/sync-primary: ${primaryAttempt.error}`);
    }

    if (shouldTryCompact) {
      const compactAttempt = await requestImageFromFalEndpoint(
        endpoint,
        compactInput,
        apiKey,
        `fal/sync-compact/${endpointModel}`,
        IMAGE_REQUEST_TIMEOUT_MS,
        signal,
      );

      if (compactAttempt.imageUrl) {
        return compactAttempt.imageUrl;
      }

      if (compactAttempt.error) {
        errors.push(`${endpointModel}/sync-compact: ${compactAttempt.error}`);
      }
    }

    try {
      return await requestImageFromFalQueue(
        apiHost,
        endpointModel,
        shouldTryCompact ? compactInput : primaryInput,
        apiKey,
        signal,
      );
    } catch (error) {
      if (isGenerationCanceledError(error)) {
        throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
      }

      const queueError = error instanceof Error ? error.message : String(error);
      errors.push(`${endpointModel}/queue: ${queueError}`);
    }
  }

  throw new Error(`Fal 图片生成失败（${errors.join("; ")}）`);
}

/**
 * 检查 Provider 是否支持图片生成
 * 通过 Provider ID 或 type 匹配
 */
function isImageGenProvider(providerId: string, providerType: string): boolean {
  return (
    IMAGE_GEN_PROVIDER_IDS.includes(providerId) ||
    IMAGE_GEN_PROVIDER_IDS.includes(providerType)
  );
}

function isFalProviderLike(provider: {
  id: string;
  type: string;
  api_host: string;
}): boolean {
  if (provider.id === "fal" || provider.type === "fal") {
    return true;
  }

  const normalizedHost = provider.api_host.trim().toLowerCase();
  return (
    normalizedHost.includes("fal.run") ||
    normalizedHost.includes("queue.fal.run")
  );
}

export function useImageGen(options: UseImageGenOptions = {}) {
  const { providers, loading: providersLoading } = useApiKeyProvider();
  const preferredProviderId = options.preferredProviderId?.trim() || "";
  const preferredModelId = options.preferredModelId?.trim() || "";
  const allowFallback = options.allowFallback ?? true;

  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("1024x1024");
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resourceSavingCount, setResourceSavingCount] = useState(0);
  const imagesRef = useRef<GeneratedImage[]>([]);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const generationRunIdRef = useRef(0);
  const syncedPreferredProviderIdRef = useRef("");
  const syncedPreferredModelIdRef = useRef("");
  const hasManualProviderSelectionRef = useRef(false);

  // 过滤出支持图片生成、启用且有 API Key 的 Provider
  const availableProviders = useMemo(() => {
    imageGenDebugLog(
      "[useImageGen] 支持图片生成的 Provider IDs:",
      IMAGE_GEN_PROVIDER_IDS,
    );
    imageGenDebugLog(
      "[useImageGen] 所有 Provider:",
      providers.map((p) => ({
        id: p.id,
        type: p.type,
        enabled: p.enabled,
        api_key_count: p.api_key_count,
        isImageGen: isImageGenProvider(p.id, p.type),
      })),
    );

    const filtered = providers.filter(
      (p) =>
        p.enabled && p.api_key_count > 0 && isImageGenProvider(p.id, p.type),
    );

    imageGenDebugLog(
      "[useImageGen] 过滤后的 Provider:",
      filtered.map((p) => p.id),
    );
    return filtered;
  }, [providers]);

  // 从 localStorage 加载历史记录
  useEffect(() => {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GeneratedImage[];
        setImages(parsed);
        if (parsed.length > 0) {
          setSelectedImageId(parsed[0].id);
        }
      } catch (e) {
        console.error("加载历史记录失败:", e);
      }
    }
  }, []);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // 自动选择可用 Provider，优先使用项目偏好
  useEffect(() => {
    if (availableProviders.length === 0) {
      if (selectedProviderId) {
        setSelectedProviderId("");
      }
      return;
    }

    const preferredProvider = preferredProviderId
      ? availableProviders.find(
          (provider) => provider.id === preferredProviderId,
        )
      : null;
    const preferredProviderChanged =
      syncedPreferredProviderIdRef.current !== preferredProviderId;
    const currentProviderAvailable = availableProviders.some(
      (provider) => provider.id === selectedProviderId,
    );

    if (preferredProviderChanged) {
      syncedPreferredProviderIdRef.current = preferredProviderId;
      if (preferredProvider && selectedProviderId !== preferredProvider.id) {
        hasManualProviderSelectionRef.current = false;
        setSelectedProviderId(preferredProvider.id);
        return;
      }
    }

    if (preferredProviderId && !preferredProvider && !allowFallback) {
      if (
        selectedProviderId &&
        currentProviderAvailable &&
        hasManualProviderSelectionRef.current
      ) {
        return;
      }
      if (selectedProviderId) {
        hasManualProviderSelectionRef.current = false;
        setSelectedProviderId("");
      }
      return;
    }

    if (selectedProviderId && currentProviderAvailable) {
      return;
    }

    const nextProvider =
      preferredProvider ?? (allowFallback ? availableProviders[0] : null);

    if (nextProvider) {
      hasManualProviderSelectionRef.current = false;
      setSelectedProviderId(nextProvider.id);
    }
  }, [
    allowFallback,
    availableProviders,
    preferredProviderId,
    selectedProviderId,
  ]);

  // 保存历史记录
  const saveHistory = useCallback((newImages: GeneratedImage[]) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newImages.slice(0, 50)));
  }, []);

  const cancelGeneration = useCallback(() => {
    generationRunIdRef.current += 1;
    const activeController = generationAbortControllerRef.current;
    generationAbortControllerRef.current = null;

    if (activeController && !activeController.signal.aborted) {
      activeController.abort(
        createAbortError(IMAGE_GENERATION_CANCELED_MESSAGE),
      );
    }

    setGenerating(false);
    setImages((prev) => {
      let changed = false;
      const updated = prev.map((image) => {
        if (image.status !== "generating") {
          return image;
        }
        changed = true;
        return {
          ...image,
          status: "error" as const,
          error: IMAGE_GENERATION_CANCELED_MESSAGE,
        };
      });

      if (!changed) {
        return prev;
      }

      saveHistory(updated);
      return updated;
    });
  }, [saveHistory]);

  useEffect(() => {
    return () => {
      generationRunIdRef.current += 1;
      const activeController = generationAbortControllerRef.current;
      generationAbortControllerRef.current = null;
      if (activeController && !activeController.signal.aborted) {
        activeController.abort(
          createAbortError(IMAGE_GENERATION_CANCELED_MESSAGE),
        );
      }
    };
  }, []);

  const savingToResource = resourceSavingCount > 0;

  const saveImageToResource = useCallback(
    async (
      image: GeneratedImage,
      targetProjectId: string,
    ): Promise<SaveImageToResourceResult> => {
      const normalizedTargetProjectId = targetProjectId.trim();
      if (!normalizedTargetProjectId) {
        return { saved: false, skipped: true, error: "未指定目标资源库" };
      }

      if (image.status !== "complete" || !image.url) {
        return { saved: false, skipped: true };
      }

      const existing = imagesRef.current.find((item) => item.id === image.id);
      if (
        existing?.resourceMaterialId &&
        existing.resourceProjectId === normalizedTargetProjectId
      ) {
        return { saved: false, skipped: true };
      }

      const request: ImportMaterialFromUrlRequest = {
        projectId: normalizedTargetProjectId,
        name: buildGeneratedImageMaterialName(image),
        type: "image",
        url: image.url,
        tags: [IMAGE_GEN_MATERIAL_TAG],
        description: `图片生成自动入库（模型：${image.model}，尺寸：${image.size}）`,
      };

      setResourceSavingCount((count) => count + 1);
      try {
        const savedMaterial = await importMaterialFromUrl(request);

        const savedAt = Date.now();
        setImages((prev) => {
          const updated = prev.map((item) =>
            item.id === image.id
              ? {
                  ...item,
                  resourceMaterialId: savedMaterial.id,
                  resourceProjectId: normalizedTargetProjectId,
                  resourceSavedAt: savedAt,
                  resourceSaveError: undefined,
                }
              : item,
          );
          saveHistory(updated);
          return updated;
        });
        setStoredResourceProjectId(normalizedTargetProjectId, {
          source: "image-gen-save",
          syncLegacy: true,
          emitEvent: true,
        });

        return { saved: true, skipped: false };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        setImages((prev) => {
          const updated = prev.map((item) =>
            item.id === image.id
              ? { ...item, resourceSaveError: errorMessage }
              : item,
          );
          saveHistory(updated);
          return updated;
        });

        return { saved: false, skipped: false, error: errorMessage };
      } finally {
        setResourceSavingCount((count) => Math.max(0, count - 1));
      }
    },
    [saveHistory],
  );

  // 获取当前选中的 Provider
  const selectedProvider = useMemo(() => {
    return availableProviders.find((p) => p.id === selectedProviderId);
  }, [availableProviders, selectedProviderId]);
  const preferredProviderUnavailable = useMemo(
    () =>
      Boolean(preferredProviderId) &&
      !providersLoading &&
      !availableProviders.some(
        (provider) => provider.id === preferredProviderId,
      ),
    [availableProviders, preferredProviderId, providersLoading],
  );

  // 获取当前 Provider 支持的模型
  const availableModels = useMemo(() => {
    if (!selectedProvider) return [];
    return getImageModelsForProvider(
      selectedProvider.id,
      selectedProvider.type,
      selectedProvider.custom_models,
      selectedProvider.api_host,
    );
  }, [selectedProvider]);

  // 获取当前选中的模型
  const selectedModel = useMemo(() => {
    return availableModels.find((m) => m.id === selectedModelId);
  }, [availableModels, selectedModelId]);

  useEffect(() => {
    if (availableModels.length === 0) {
      return;
    }

    const preferredModelChanged =
      syncedPreferredModelIdRef.current !== preferredModelId;

    if (preferredModelChanged) {
      syncedPreferredModelIdRef.current = preferredModelId;
      if (
        preferredModelId &&
        availableModels.some((model) => model.id === preferredModelId) &&
        selectedModelId !== preferredModelId
      ) {
        setSelectedModelId(preferredModelId);
        return;
      }
    }

    if (
      preferredModelId &&
      availableModels.some((model) => model.id === preferredModelId) &&
      selectedModelId !== preferredModelId
    ) {
      setSelectedModelId(preferredModelId);
      return;
    }

    const hasSelectedModel = availableModels.some(
      (model) => model.id === selectedModelId,
    );

    if (!hasSelectedModel) {
      setSelectedModelId(availableModels[0]?.id ?? "");
    }
  }, [availableModels, preferredModelId, selectedModelId]);

  // 获取当前选中的图片
  const selectedImage = useMemo(() => {
    return images.find((img) => img.id === selectedImageId);
  }, [images, selectedImageId]);

  // 切换 Provider 时更新模型
  const handleProviderChange = useCallback(
    (providerId: string) => {
      hasManualProviderSelectionRef.current = true;
      setSelectedProviderId(providerId);
      const provider = availableProviders.find((p) => p.id === providerId);
      if (provider) {
        const models = getImageModelsForProvider(
          provider.id,
          provider.type,
          provider.custom_models,
          provider.api_host,
        );
        if (models.length > 0) {
          setSelectedModelId(models[0].id);
        }
      }
    },
    [availableProviders],
  );

  // 生成图片
  const generateImage = useCallback(
    async (
      prompt: string,
      options?: GenerateImageOptions,
    ): Promise<GeneratedImage[]> => {
      if (!selectedProvider) {
        if (preferredProviderUnavailable && !allowFallback) {
          throw new Error(
            `当前默认图片服务不可用：${preferredProviderId}。请到媒体服务 > 图片服务中调整默认 Provider，或开启自动回退。`,
          );
        }
        throw new Error("请先在凭证管理中配置 API Key Provider");
      }

      const generationCount = Math.max(
        1,
        Math.min(options?.imageCount ?? 1, 8),
      );
      const requestSize = options?.size || selectedSize;
      const referenceImages = options?.referenceImages || [];
      const targetProjectId = options?.targetProjectId?.trim() || "";
      const resolvedModelId =
        selectedModel?.id || availableModels[0]?.id || selectedModelId;

      if (!resolvedModelId) {
        throw new Error(
          "当前图片服务没有可用模型，请到媒体服务 > 图片服务中检查模型配置。",
        );
      }

      if (
        generationAbortControllerRef.current &&
        !generationAbortControllerRef.current.signal.aborted
      ) {
        cancelGeneration();
      }

      const generationController = new AbortController();
      const generationRunId = generationRunIdRef.current + 1;
      generationRunIdRef.current = generationRunId;
      generationAbortControllerRef.current = generationController;

      const ensureGenerationStillActive = () => {
        if (
          generationRunIdRef.current !== generationRunId ||
          generationController.signal.aborted
        ) {
          throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
        }
      };

      const canCommitGenerationState = () =>
        generationRunIdRef.current === generationRunId &&
        !generationController.signal.aborted;

      const baseId = Date.now();
      const generationItems: GeneratedImage[] = Array.from(
        { length: generationCount },
        (_, index) => ({
          id: `img-${baseId}-${index}`,
          url: "",
          prompt,
          model: resolvedModelId,
          size: requestSize,
          providerId: selectedProvider.id,
          providerName: selectedProvider.name,
          createdAt: baseId + index,
          status: "generating",
        }),
      );

      setImages((prev) => {
        const updated = [...generationItems, ...prev];
        saveHistory(updated);
        return updated;
      });
      setSelectedImageId(generationItems[0]?.id || null);

      setGenerating(true);
      const completedResults: GeneratedImage[] = [];
      const generationErrors: string[] = [];

      try {
        const isNewApi =
          selectedProvider.id === "new-api" ||
          selectedProvider.type === "new-api" ||
          selectedProvider.type === "NewApi";
        const isFalProvider = isFalProviderLike(selectedProvider);

        if (isNewApi) {
          for (const item of generationItems) {
            try {
              ensureGenerationStillActive();
              const apiKey = await apiKeyProviderApi.getNextApiKey(
                selectedProvider.id,
              );
              ensureGenerationStillActive();
              if (!apiKey) {
                throw new Error(
                  "该 Provider 没有可用的 API Key，请在凭证管理中添加",
                );
              }

              const imageUrl = await requestImageFromNewApi(
                selectedProvider.api_host,
                apiKey,
                resolvedModelId,
                prompt,
                referenceImages,
                requestSize,
                generationController.signal,
              );
              ensureGenerationStillActive();

              const completedImage: GeneratedImage = {
                ...item,
                url: imageUrl,
                status: "complete",
                error: undefined,
              };

              setImages((prev) => {
                if (!canCommitGenerationState()) {
                  return prev;
                }
                const updated = prev.map((img) =>
                  img.id === item.id
                    ? {
                        ...img,
                        url: imageUrl,
                        status: "complete" as const,
                        error: undefined,
                      }
                    : img,
                );
                saveHistory(updated);
                return updated;
              });

              if (targetProjectId) {
                ensureGenerationStillActive();
                await saveImageToResource(completedImage, targetProjectId);
                ensureGenerationStillActive();
              }

              completedResults.push(completedImage);
            } catch (error) {
              if (
                isGenerationCanceledError(error) ||
                generationRunIdRef.current !== generationRunId ||
                generationController.signal.aborted
              ) {
                throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
              }

              const errorMessage =
                error instanceof Error ? error.message : String(error);
              generationErrors.push(errorMessage);

              setImages((prev) => {
                if (!canCommitGenerationState()) {
                  return prev;
                }
                const updated = prev.map((img) =>
                  img.id === item.id
                    ? { ...img, status: "error" as const, error: errorMessage }
                    : img,
                );
                saveHistory(updated);
                return updated;
              });
            }
          }
        } else if (isFalProvider) {
          for (const item of generationItems) {
            try {
              ensureGenerationStillActive();
              const apiKey = await apiKeyProviderApi.getNextApiKey(
                selectedProvider.id,
              );
              ensureGenerationStillActive();
              if (!apiKey) {
                throw new Error(
                  "该 Provider 没有可用的 API Key，请在凭证管理中添加",
                );
              }

              const imageUrl = await requestImageFromFal(
                selectedProvider.api_host,
                apiKey,
                resolvedModelId,
                prompt,
                referenceImages,
                requestSize,
                generationController.signal,
              );
              ensureGenerationStillActive();

              const completedImage: GeneratedImage = {
                ...item,
                url: imageUrl,
                status: "complete",
                error: undefined,
              };

              setImages((prev) => {
                if (!canCommitGenerationState()) {
                  return prev;
                }
                const updated = prev.map((img) =>
                  img.id === item.id
                    ? {
                        ...img,
                        url: imageUrl,
                        status: "complete" as const,
                        error: undefined,
                      }
                    : img,
                );
                saveHistory(updated);
                return updated;
              });

              if (targetProjectId) {
                ensureGenerationStillActive();
                await saveImageToResource(completedImage, targetProjectId);
                ensureGenerationStillActive();
              }

              completedResults.push(completedImage);
            } catch (error) {
              if (
                isGenerationCanceledError(error) ||
                generationRunIdRef.current !== generationRunId ||
                generationController.signal.aborted
              ) {
                throw new Error(IMAGE_GENERATION_CANCELED_MESSAGE);
              }

              const errorMessage =
                error instanceof Error ? error.message : String(error);
              generationErrors.push(errorMessage);

              setImages((prev) => {
                if (!canCommitGenerationState()) {
                  return prev;
                }
                const updated = prev.map((img) =>
                  img.id === item.id
                    ? { ...img, status: "error" as const, error: errorMessage }
                    : img,
                );
                saveHistory(updated);
                return updated;
              });
            }
          }
        } else {
          const apiKey = await apiKeyProviderApi.getNextApiKey(
            selectedProvider.id,
          );
          ensureGenerationStillActive();
          if (!apiKey) {
            throw new Error(
              "该 Provider 没有可用的 API Key，请在凭证管理中添加",
            );
          }

          const request: ImageGenRequest = {
            model: resolvedModelId,
            prompt,
            n: generationCount,
            size: requestSize,
          };

          const endpoint = buildProviderEndpoint(
            selectedProvider.api_host,
            "/v1/images/generations",
          );

          const response = await fetchWithManagedAbort(
            endpoint,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(request),
            },
            {
              timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
              signal: generationController.signal,
            },
          );

          const contentType = response.headers.get("content-type") || "";
          const rawText = await response.text();
          const parsedJson = tryParseJson(rawText);
          ensureGenerationStillActive();

          console.log(
            `[ImageGen][standard/images] endpoint=${endpoint}, status=${response.status}, content-type=${contentType}`,
          );

          if (parsedJson && typeof parsedJson === "object") {
            console.log(
              "[ImageGen][standard/images] response keys:",
              Object.keys(parsedJson as Record<string, unknown>),
            );
          } else {
            console.log(
              "[ImageGen][standard/images] response preview:",
              previewResponseText(rawText),
            );
          }

          if (!response.ok) {
            throw new Error(
              `请求失败: ${response.status} - ${previewResponseText(rawText, 300)}`,
            );
          }

          const data = (parsedJson || {}) as ImageGenResponse;
          const urls = (data.data || [])
            .map((item) => {
              if (item.url) {
                return item.url;
              }
              if (item.b64_json) {
                return wrapBase64AsDataUrl(item.b64_json);
              }
              return "";
            })
            .filter(Boolean);

          if (urls.length === 0) {
            const fallbackUrl = extractImageUrlFromPayload(
              parsedJson || rawText,
            );
            if (fallbackUrl) {
              urls.push(fallbackUrl);
            }
          }

          if (urls.length === 0) {
            throw new Error("未返回图片 URL（响应中未检测到可解析图片字段）");
          }

          const completedImages: GeneratedImage[] = generationItems.flatMap(
            (item, index) => {
              const imageUrl = urls[index];
              if (!imageUrl) {
                return [];
              }
              return [
                {
                  ...item,
                  url: imageUrl,
                  status: "complete" as const,
                  error: undefined,
                },
              ];
            },
          );

          setImages((prev) => {
            if (!canCommitGenerationState()) {
              return prev;
            }
            const updated = prev.map((img) => {
              const index = generationItems.findIndex(
                (item) => item.id === img.id,
              );

              if (index === -1) return img;

              const imageUrl = urls[index];
              if (imageUrl) {
                return {
                  ...img,
                  url: imageUrl,
                  status: "complete" as const,
                  error: undefined,
                };
              }

              return {
                ...img,
                status: "error" as const,
                error: "服务返回的图片数量少于请求数量",
              };
            });

            saveHistory(updated);
            return updated;
          });

          if (targetProjectId) {
            for (const image of completedImages) {
              ensureGenerationStillActive();
              await saveImageToResource(image, targetProjectId);
              ensureGenerationStillActive();
            }
          }

          completedResults.push(...completedImages);
        }

        if (completedResults.length === 0 && generationErrors.length > 0) {
          throw new Error(summarizeImageGenerationErrors(generationErrors));
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const canceled =
          isGenerationCanceledError(error) ||
          generationRunIdRef.current !== generationRunId ||
          generationController.signal.aborted;

        if (!canceled) {
          setImages((prev) => {
            if (!canCommitGenerationState()) {
              return prev;
            }
            const updated = prev.map((img) =>
              generationItems.some((item) => item.id === img.id) &&
              img.status === "generating"
                ? { ...img, status: "error" as const, error: errorMessage }
                : img,
            );
            saveHistory(updated);
            return updated;
          });
        }

        throw canceled ? new Error(IMAGE_GENERATION_CANCELED_MESSAGE) : error;
      } finally {
        if (generationRunIdRef.current === generationRunId) {
          generationAbortControllerRef.current = null;
          setGenerating(false);
        }
      }

      ensureGenerationStillActive();
      return completedResults;
    },
    [
      allowFallback,
      cancelGeneration,
      preferredProviderId,
      preferredProviderUnavailable,
      selectedProvider,
      selectedModel,
      selectedModelId,
      selectedSize,
      saveHistory,
      saveImageToResource,
      availableModels,
    ],
  );

  const backfillImagesToResource = useCallback(
    async (
      targetProjectId: string,
      imageIds?: string[],
    ): Promise<BackfillImagesResult> => {
      const normalizedTargetProjectId = targetProjectId.trim();
      const imageIdSet =
        imageIds && imageIds.length > 0 ? new Set(imageIds) : null;
      const completedImages = imagesRef.current.filter(
        (image) =>
          image.status === "complete" &&
          !!image.url &&
          (!imageIdSet || imageIdSet.has(image.id)),
      );
      const result: BackfillImagesResult = {
        total: completedImages.length,
        saved: 0,
        failed: 0,
        skipped: 0,
        errors: [],
      };

      if (!normalizedTargetProjectId) {
        if (completedImages.length > 0) {
          result.failed = completedImages.length;
          result.errors.push("未指定目标资源库");
        }
        return result;
      }

      for (const image of completedImages) {
        if (
          image.resourceMaterialId &&
          image.resourceProjectId === normalizedTargetProjectId
        ) {
          result.skipped += 1;
          continue;
        }

        const saveResult = await saveImageToResource(
          image,
          normalizedTargetProjectId,
        );

        if (saveResult.skipped) {
          result.skipped += 1;
          continue;
        }

        if (saveResult.saved) {
          result.saved += 1;
          continue;
        }

        result.failed += 1;
        if (saveResult.error) {
          result.errors.push(`${image.id}: ${saveResult.error}`);
        }
      }

      return result;
    },
    [saveImageToResource],
  );

  const saveImagesToResource = useCallback(
    async (
      imageIds: string[],
      targetProjectId: string,
    ): Promise<BackfillImagesResult> =>
      backfillImagesToResource(targetProjectId, imageIds),
    [backfillImagesToResource],
  );

  // 删除图片
  const deleteImage = useCallback(
    (id: string) => {
      setImages((prev) => {
        const updated = prev.filter((img) => img.id !== id);
        if (selectedImageId === id) {
          setSelectedImageId(updated[0]?.id || null);
        }
        saveHistory(updated);
        return updated;
      });
    },
    [selectedImageId, saveHistory],
  );

  // 新建图片（创建一个新的空白图片项）
  const newImage = useCallback(() => {
    imageGenDebugLog("[useImageGen] newImage 被调用，创建新图片项");
    const imageId = `img-${Date.now()}`;
    const newImg: GeneratedImage = {
      id: imageId,
      url: "",
      prompt: "",
      model: selectedModelId,
      size: selectedSize,
      providerId: selectedProviderId,
      providerName: selectedProvider?.name || "",
      createdAt: Date.now(),
      status: "pending",
    };

    setImages((prev) => {
      const updated = [newImg, ...prev];
      saveHistory(updated);
      return updated;
    });
    setSelectedImageId(imageId);
  }, [
    selectedModelId,
    selectedSize,
    selectedProviderId,
    selectedProvider,
    saveHistory,
  ]);

  return {
    // Provider 相关
    availableProviders,
    selectedProvider,
    selectedProviderId,
    setSelectedProviderId: handleProviderChange,
    providersLoading,
    preferredProviderUnavailable,

    // 模型相关
    availableModels,
    selectedModel,
    selectedModelId,
    setSelectedModelId,

    // 尺寸相关
    selectedSize,
    setSelectedSize,

    // 图片相关
    images,
    selectedImage,
    selectedImageId,
    setSelectedImageId,
    generating,
    savingToResource,

    // 操作
    generateImage,
    cancelGeneration,
    backfillImagesToResource,
    saveImagesToResource,
    deleteImage,
    newImage,
  };
}

export const __imageGenFalTestUtils = {
  resolveFalEndpointModelCandidates,
  buildFalEndpoint,
  buildFalInput,
  resolveFalQueueHost,
  requestImageFromFalQueue,
  requestImageFromFal,
};
