import type {
  LayeredDesignFlatImageOcrTextBlock,
  LayeredDesignFlatImageTextOcrProvider,
  LayeredDesignFlatImageTextOcrProviderInput,
} from "./analyzer";
import type {
  LayeredDesignWorkerHeuristicTextCandidateExtractor,
  LayeredDesignWorkerHeuristicTextCandidateResult,
  LayeredDesignWorkerHeuristicTextCandidateExtractorResult,
} from "./structuredAnalyzerWorkerHeuristic";
import type { GeneratedDesignAsset, Rect } from "./types";

export interface CreateLayeredDesignDeterministicTextOcrProviderOptions {
  label?: string;
  text?: string;
  confidence?: number;
  boundingBox?: Pick<Rect, "x" | "y" | "width" | "height">;
}

export interface CreateLayeredDesignPrioritizedTextOcrProviderOptions {
  label?: string;
}

export interface LayeredDesignPrioritizedTextOcrProviderResult {
  provider: LayeredDesignFlatImageTextOcrProvider;
  blocks: LayeredDesignFlatImageOcrTextBlock[];
}

const DEFAULT_DETERMINISTIC_TEXT = "LIME LAYERED TEXT";
const DEFAULT_TEXT_COLOR = "#111111";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value) {
    return Math.max(1, Math.round(fallback));
  }

  return Math.max(1, Math.round(value));
}

function normalizeDetectedTextRect(
  rect: Pick<Rect, "x" | "y" | "width" | "height"> | undefined,
  fallback: Rect,
): Rect {
  if (!rect) {
    return { ...fallback };
  }

  const width = clamp(
    normalizePositiveInteger(rect.width, fallback.width),
    1,
    fallback.width,
  );
  const height = clamp(
    normalizePositiveInteger(rect.height, fallback.height),
    1,
    fallback.height,
  );
  const x = clamp(Math.round(rect.x), 0, Math.max(0, fallback.width - width));
  const y = clamp(
    Math.round(rect.y),
    0,
    Math.max(0, fallback.height - height),
  );

  return { x, y, width, height };
}

function inferTextLayerFontSize(height: number): number {
  return clamp(Math.round(height * 0.8), 18, 96);
}

function normalizeOcrBlocks(
  blocks: LayeredDesignFlatImageOcrTextBlock[],
  fallbackRect: Rect,
): Array<{
  text: string;
  rect: Rect;
  confidence?: number;
  params?: Record<string, unknown>;
}> {
  return blocks
    .map((block) => ({
      text: block.text.trim(),
      rect: normalizeDetectedTextRect(block.boundingBox, fallbackRect),
      ...(typeof block.confidence === "number" &&
      Number.isFinite(block.confidence)
        ? { confidence: clamp(block.confidence, 0, 1) }
        : {}),
      ...(block.params ? { params: { ...block.params } } : {}),
    }))
    .filter((block) => block.text.length > 0);
}

function isTextOcrProvider(
  provider: LayeredDesignFlatImageTextOcrProvider | null | undefined,
): provider is LayeredDesignFlatImageTextOcrProvider {
  return Boolean(provider);
}

function hasRecognizedText(blocks: LayeredDesignFlatImageOcrTextBlock[]) {
  return blocks.some((block) => block.text.trim().length > 0);
}

export async function detectTextWithLayeredDesignPrioritizedTextOcrProviders(
  providers: Array<LayeredDesignFlatImageTextOcrProvider | null | undefined>,
  input: LayeredDesignFlatImageTextOcrProviderInput,
): Promise<LayeredDesignPrioritizedTextOcrProviderResult | null> {
  const priorityProviders = providers.filter(isTextOcrProvider);

  for (const provider of priorityProviders) {
    try {
      const blocks = await provider.detectText(input);
      if (Array.isArray(blocks) && hasRecognizedText(blocks)) {
        return { provider, blocks };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function createLayeredDesignDeterministicTextOcrProvider(
  options: CreateLayeredDesignDeterministicTextOcrProviderOptions = {},
): LayeredDesignFlatImageTextOcrProvider {
  return {
    label: options.label ?? "Deterministic text OCR placeholder",
    detectText: async (input) => {
      const text = (options.text ?? DEFAULT_DETERMINISTIC_TEXT).trim();
      if (!text) {
        return [];
      }

      return [
        {
          text,
          boundingBox: options.boundingBox ?? {
            x: 0,
            y: 0,
            width: input.candidate.asset.width || input.candidate.rect.width,
            height: input.candidate.asset.height || input.candidate.rect.height,
          },
          confidence: clamp(options.confidence ?? 0.9, 0, 1),
        },
      ];
    },
  };
}

export function createLayeredDesignPrioritizedTextOcrProvider(
  providers: Array<LayeredDesignFlatImageTextOcrProvider | null | undefined>,
  options: CreateLayeredDesignPrioritizedTextOcrProviderOptions = {},
): LayeredDesignFlatImageTextOcrProvider {
  const priorityProviders = providers.filter(isTextOcrProvider);

  return {
    label:
      options.label ??
      (priorityProviders.length > 0
        ? `OCR priority: ${priorityProviders
            .map((provider) => provider.label)
            .join(" -> ")}`
        : "OCR priority: empty"),
    detectText: async (input) => {
      const result =
        await detectTextWithLayeredDesignPrioritizedTextOcrProviders(
          priorityProviders,
          input,
        );

      return result?.blocks ?? [];
    },
  };
}

export function createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(
  provider: LayeredDesignFlatImageTextOcrProvider,
): LayeredDesignWorkerHeuristicTextCandidateExtractor {
  return async (input): Promise<LayeredDesignWorkerHeuristicTextCandidateExtractorResult> => {
    const cropAsset: GeneratedDesignAsset = {
      id: `${input.candidate.id}-ocr-crop`,
      kind: "text_raster",
      src: input.candidate.crop.src,
      width: input.candidate.crop.width,
      height: input.candidate.crop.height,
      hasAlpha: true,
      createdAt: input.createdAt,
      provider: provider.label,
      params: {
        seed: "worker_heuristic_text_ocr_crop",
      },
    };
    const fallbackRect: Rect = {
      x: 0,
      y: 0,
      width: input.candidate.crop.width,
      height: input.candidate.crop.height,
    };

    try {
      const blocks = normalizeOcrBlocks(
        await provider.detectText({
          image: input.image,
          candidate: {
            id: input.candidate.id,
            name: input.candidate.name,
            role: "text",
            rect: { ...input.candidate.rect },
            asset: cropAsset,
          },
        }),
        fallbackRect,
      );
      if (blocks.length === 0) {
        return null;
      }

      const results: LayeredDesignWorkerHeuristicTextCandidateResult[] =
        blocks.map((block) => ({
          text: block.text,
          rect: {
            x: input.candidate.rect.x + block.rect.x,
            y: input.candidate.rect.y + block.rect.y,
            width: block.rect.width,
            height: block.rect.height,
          },
          confidence: block.confidence ?? input.candidate.confidence,
          fontSize: inferTextLayerFontSize(block.rect.height),
          color: DEFAULT_TEXT_COLOR,
          align: "center",
          lineHeight: 1.1,
          ...(block.params ? { params: { ...block.params } } : {}),
        }));

      return results.length === 1 ? results[0] : results;
    } catch {
      return null;
    }
  };
}
