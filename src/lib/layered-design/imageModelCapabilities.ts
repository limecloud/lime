import type { LayeredDesignAssetGenerationRequest } from "./generation";

const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_2_MAX_EDGE = 3_840;
const GPT_IMAGE_2_SIZE_MULTIPLE = 16;
const GPT_IMAGE_2_MAX_RATIO = 3;
const FLUX_MAX_PIXELS = 4_194_304;
const STABLE_DIFFUSION_MAX_PIXELS = 4_194_304;
const STABLE_DIFFUSION_SIZE_MULTIPLE = 64;
const DEFAULT_CHROMA_KEY_COLOR = "#00ff00";
const OPENAI_GPT_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"];
const DALLE_3_SIZES = ["1024x1024", "1792x1024", "1024x1792"];
const DALLE_2_SIZES = ["1024x1024", "512x512", "256x256"];

export type LayeredDesignImageModelFamily =
  | "openai-gpt-image-2"
  | "openai-gpt-image"
  | "openai-dalle"
  | "google-imagen"
  | "flux"
  | "stable-diffusion"
  | "ideogram"
  | "recraft"
  | "seedream"
  | "cogview"
  | "midjourney"
  | "generic";

export type LayeredDesignImageSizePolicy =
  | "flexible_pixels"
  | "allowed_sizes"
  | "multiple_pixels"
  | "provider_passthrough";

export type LayeredDesignAlphaStrategy =
  | "none"
  | "provider_pipeline"
  | "chroma_key_postprocess";

export interface LayeredDesignImageModelCapability {
  family: LayeredDesignImageModelFamily;
  sizePolicy: LayeredDesignImageSizePolicy;
  supportsNativeTransparency: boolean | null;
  supportsImageEdit: boolean | null;
  supportsMask: boolean | null;
  supportsReferenceImages: boolean | null;
  allowedSizes?: string[];
  sizeMultiple?: number;
  minPixels?: number;
  maxPixels?: number;
  maxEdge?: number;
  maxRatio?: number;
  qualityValues?: string[];
}

export interface LayeredDesignImageTaskSize {
  width: number;
  height: number;
  size: string;
  adjusted: boolean;
  modelFamily: LayeredDesignImageModelFamily;
  sizePolicy: LayeredDesignImageSizePolicy;
}

export interface LayeredDesignAlphaPolicy {
  requested: boolean;
  strategy: LayeredDesignAlphaStrategy;
  chromaKeyColor?: string;
  postprocessRequired: boolean;
}

export type LayeredDesignImageRuntimeContract = Record<string, unknown> & {
  contract_key: "image_generation";
  layered_design: {
    document_id: string;
    layer_id: string;
    asset_id: string;
    model_family: LayeredDesignImageModelFamily;
    provider_id?: string;
    size_policy: LayeredDesignImageSizePolicy;
    requested_size: {
      width: number;
      height: number;
    };
    task_size: {
      width: number;
      height: number;
    };
    size_adjusted: boolean;
    capabilities: {
      native_transparency: boolean | null;
      image_edit: boolean | null;
      mask: boolean | null;
      reference_images: boolean | null;
    };
    alpha: LayeredDesignAlphaPolicy;
  };
};

function normalizeCapabilityToken(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function createCapability(
  params: LayeredDesignImageModelCapability,
): LayeredDesignImageModelCapability {
  return params;
}

export function isGptImage2Model(model?: string): boolean {
  const normalized = normalizeCapabilityToken(model);
  return (
    normalized === "gpt-image-2" ||
    normalized === "gpt-images-2" ||
    normalized.endsWith("/gpt-image-2") ||
    normalized.endsWith("/gpt-images-2")
  );
}

export function resolveLayeredDesignImageModelCapability(
  model?: string,
  providerId?: string,
): LayeredDesignImageModelCapability {
  const normalizedModel = normalizeCapabilityToken(model);
  const normalizedProvider = normalizeCapabilityToken(providerId);
  const combined = `${normalizedProvider} ${normalizedModel}`;

  if (isGptImage2Model(model)) {
    return createCapability({
      family: "openai-gpt-image-2",
      sizePolicy: "flexible_pixels",
      supportsNativeTransparency: false,
      supportsImageEdit: true,
      supportsMask: false,
      supportsReferenceImages: true,
      sizeMultiple: GPT_IMAGE_2_SIZE_MULTIPLE,
      minPixels: GPT_IMAGE_2_MIN_PIXELS,
      maxPixels: GPT_IMAGE_2_MAX_PIXELS,
      maxEdge: GPT_IMAGE_2_MAX_EDGE,
      maxRatio: GPT_IMAGE_2_MAX_RATIO,
      qualityValues: ["low", "medium", "high", "auto"],
    });
  }

  if (/gpt-image-(1\.5|1-mini|1)\b/.test(combined)) {
    return createCapability({
      family: "openai-gpt-image",
      sizePolicy: "allowed_sizes",
      supportsNativeTransparency: true,
      supportsImageEdit: true,
      supportsMask: true,
      supportsReferenceImages: true,
      allowedSizes: OPENAI_GPT_IMAGE_SIZES,
      qualityValues: ["low", "medium", "high", "auto"],
    });
  }

  if (/\b(dall-e|dalle)\b/.test(combined)) {
    const isDalle2 = combined.includes("dall-e-2") || combined.includes("dalle-2");
    return createCapability({
      family: "openai-dalle",
      sizePolicy: "allowed_sizes",
      supportsNativeTransparency: false,
      supportsImageEdit: isDalle2,
      supportsMask: isDalle2,
      supportsReferenceImages: false,
      allowedSizes: isDalle2 ? DALLE_2_SIZES : DALLE_3_SIZES,
      qualityValues: isDalle2 ? undefined : ["standard", "hd"],
    });
  }

  if (/\b(imagen|gemini|nano-banana)\b/.test(combined)) {
    return createCapability({
      family: "google-imagen",
      sizePolicy: "provider_passthrough",
      supportsNativeTransparency: false,
      supportsImageEdit: true,
      supportsMask: null,
      supportsReferenceImages: true,
    });
  }

  if (/\b(flux|black-forest|bfl)\b/.test(combined)) {
    return createCapability({
      family: "flux",
      sizePolicy: "flexible_pixels",
      supportsNativeTransparency: false,
      supportsImageEdit: true,
      supportsMask: null,
      supportsReferenceImages: true,
      maxPixels: FLUX_MAX_PIXELS,
    });
  }

  if (/\b(stable-diffusion|stability|sdxl|sd3|sd-3)\b/.test(combined)) {
    return createCapability({
      family: "stable-diffusion",
      sizePolicy: "multiple_pixels",
      supportsNativeTransparency: false,
      supportsImageEdit: true,
      supportsMask: true,
      supportsReferenceImages: true,
      sizeMultiple: STABLE_DIFFUSION_SIZE_MULTIPLE,
      maxPixels: STABLE_DIFFUSION_MAX_PIXELS,
    });
  }

  if (combined.includes("ideogram")) {
    return createCapability({
      family: "ideogram",
      sizePolicy: "provider_passthrough",
      supportsNativeTransparency: null,
      supportsImageEdit: true,
      supportsMask: null,
      supportsReferenceImages: true,
    });
  }

  if (combined.includes("recraft")) {
    return createCapability({
      family: "recraft",
      sizePolicy: "provider_passthrough",
      supportsNativeTransparency: true,
      supportsImageEdit: true,
      supportsMask: true,
      supportsReferenceImages: true,
    });
  }

  if (/\b(seedream|doubao|byte|volcengine)\b/.test(combined)) {
    return createCapability({
      family: "seedream",
      sizePolicy: "provider_passthrough",
      supportsNativeTransparency: false,
      supportsImageEdit: true,
      supportsMask: null,
      supportsReferenceImages: true,
    });
  }

  if (/\b(cogview|zhipu|glm-image)\b/.test(combined)) {
    return createCapability({
      family: "cogview",
      sizePolicy: "provider_passthrough",
      supportsNativeTransparency: false,
      supportsImageEdit: null,
      supportsMask: null,
      supportsReferenceImages: true,
    });
  }

  if (/\b(midjourney|mj)\b/.test(combined)) {
    return createCapability({
      family: "midjourney",
      sizePolicy: "provider_passthrough",
      supportsNativeTransparency: false,
      supportsImageEdit: true,
      supportsMask: null,
      supportsReferenceImages: true,
    });
  }

  return createCapability({
    family: "generic",
    sizePolicy: "provider_passthrough",
    supportsNativeTransparency: null,
    supportsImageEdit: null,
    supportsMask: null,
    supportsReferenceImages: null,
  });
}

function roundPositive(value: number): number {
  return Math.max(1, Math.round(value));
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function ceilToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}

function floorToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function parseSize(value: string): { width: number; height: number } | null {
  const match = /^([1-9]\d*)x([1-9]\d*)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function normalizeAllowedSize(params: {
  width: number;
  height: number;
  allowedSizes: string[];
}): Pick<LayeredDesignImageTaskSize, "width" | "height"> {
  const requestedArea = params.width * params.height;
  const requestedRatio = params.width / params.height;
  const parsedSizes = params.allowedSizes
    .map(parseSize)
    .filter((size): size is { width: number; height: number } =>
      Boolean(size),
    );

  const best = parsedSizes
    .map((size) => {
      const ratioScore = Math.abs(Math.log(requestedRatio / (size.width / size.height)));
      const areaScore = Math.abs(
        Math.log(requestedArea / (size.width * size.height)),
      );
      return {
        size,
        score: ratioScore * 3 + areaScore,
      };
    })
    .sort((left, right) => left.score - right.score)[0]?.size;

  return best ?? { width: params.width, height: params.height };
}

function resizeToPixelRange(params: {
  width: number;
  height: number;
  minPixels: number;
  maxPixels: number;
  maxEdge: number;
}): { width: number; height: number } {
  const area = params.width * params.height;
  const maxEdge = Math.max(params.width, params.height);
  let scale = 1;

  if (area < params.minPixels) {
    scale = Math.sqrt(params.minPixels / area);
  } else if (area > params.maxPixels || maxEdge > params.maxEdge) {
    scale = Math.min(
      Math.sqrt(params.maxPixels / area),
      params.maxEdge / maxEdge,
    );
  }

  return {
    width: Math.max(1, params.width * scale),
    height: Math.max(1, params.height * scale),
  };
}

function enforceRatio(params: {
  width: number;
  height: number;
  maxRatio: number;
}): { width: number; height: number } {
  if (params.width / params.height > params.maxRatio) {
    return {
      width: params.width,
      height: Math.ceil(params.width / params.maxRatio),
    };
  }

  if (params.height / params.width > params.maxRatio) {
    return {
      width: Math.ceil(params.height / params.maxRatio),
      height: params.height,
    };
  }

  return { width: params.width, height: params.height };
}

function normalizeGptImage2Size(
  width: number,
  height: number,
): Pick<LayeredDesignImageTaskSize, "width" | "height"> {
  let next = enforceRatio({
    width: roundPositive(width),
    height: roundPositive(height),
    maxRatio: GPT_IMAGE_2_MAX_RATIO,
  });

  next = resizeToPixelRange({
    ...next,
    minPixels: GPT_IMAGE_2_MIN_PIXELS,
    maxPixels: GPT_IMAGE_2_MAX_PIXELS,
    maxEdge: GPT_IMAGE_2_MAX_EDGE,
  });

  next = {
    width: roundToMultiple(next.width, GPT_IMAGE_2_SIZE_MULTIPLE),
    height: roundToMultiple(next.height, GPT_IMAGE_2_SIZE_MULTIPLE),
  };

  if (Math.max(next.width, next.height) > GPT_IMAGE_2_MAX_EDGE) {
    const scale = GPT_IMAGE_2_MAX_EDGE / Math.max(next.width, next.height);
    next = {
      width: floorToMultiple(next.width * scale, GPT_IMAGE_2_SIZE_MULTIPLE),
      height: floorToMultiple(next.height * scale, GPT_IMAGE_2_SIZE_MULTIPLE),
    };
  }

  while (next.width * next.height > GPT_IMAGE_2_MAX_PIXELS) {
    next = {
      width: floorToMultiple(next.width * 0.98, GPT_IMAGE_2_SIZE_MULTIPLE),
      height: floorToMultiple(next.height * 0.98, GPT_IMAGE_2_SIZE_MULTIPLE),
    };
  }

  while (next.width * next.height < GPT_IMAGE_2_MIN_PIXELS) {
    next = {
      width: ceilToMultiple(next.width * 1.02, GPT_IMAGE_2_SIZE_MULTIPLE),
      height: ceilToMultiple(next.height * 1.02, GPT_IMAGE_2_SIZE_MULTIPLE),
    };
  }

  next = enforceRatio({
    ...next,
    maxRatio: GPT_IMAGE_2_MAX_RATIO,
  });

  return {
    width: roundToMultiple(next.width, GPT_IMAGE_2_SIZE_MULTIPLE),
    height: roundToMultiple(next.height, GPT_IMAGE_2_SIZE_MULTIPLE),
  };
}

function normalizeMaxPixelSize(params: {
  width: number;
  height: number;
  maxPixels: number;
}): Pick<LayeredDesignImageTaskSize, "width" | "height"> {
  const area = params.width * params.height;
  if (area <= params.maxPixels) {
    return {
      width: params.width,
      height: params.height,
    };
  }

  const scale = Math.sqrt(params.maxPixels / area);
  return {
    width: roundPositive(params.width * scale),
    height: roundPositive(params.height * scale),
  };
}

function normalizeMultiplePixelSize(params: {
  width: number;
  height: number;
  multiple: number;
  maxPixels?: number;
}): Pick<LayeredDesignImageTaskSize, "width" | "height"> {
  let next = {
    width: roundToMultiple(params.width, params.multiple),
    height: roundToMultiple(params.height, params.multiple),
  };

  if (!params.maxPixels) {
    return next;
  }

  while (next.width * next.height > params.maxPixels) {
    next = {
      width: floorToMultiple(next.width * 0.98, params.multiple),
      height: floorToMultiple(next.height * 0.98, params.multiple),
    };
  }

  return next;
}

function normalizeSizeByCapability(params: {
  width: number;
  height: number;
  capability: LayeredDesignImageModelCapability;
}): Pick<LayeredDesignImageTaskSize, "width" | "height"> {
  switch (params.capability.sizePolicy) {
    case "flexible_pixels":
      if (params.capability.family === "openai-gpt-image-2") {
        return normalizeGptImage2Size(params.width, params.height);
      }

      if (params.capability.maxPixels) {
        return normalizeMaxPixelSize({
          width: params.width,
          height: params.height,
          maxPixels: params.capability.maxPixels,
        });
      }

      return { width: params.width, height: params.height };
    case "allowed_sizes":
      return normalizeAllowedSize({
        width: params.width,
        height: params.height,
        allowedSizes: params.capability.allowedSizes ?? [],
      });
    case "multiple_pixels":
      return normalizeMultiplePixelSize({
        width: params.width,
        height: params.height,
        multiple: params.capability.sizeMultiple ?? 1,
        maxPixels: params.capability.maxPixels,
      });
    case "provider_passthrough":
      return { width: params.width, height: params.height };
  }
}

export function normalizeLayeredDesignImageTaskSize(params: {
  width: number;
  height: number;
  model?: string;
  providerId?: string;
}): LayeredDesignImageTaskSize {
  const requested = {
    width: roundPositive(params.width),
    height: roundPositive(params.height),
  };
  const capability = resolveLayeredDesignImageModelCapability(
    params.model,
    params.providerId,
  );
  const normalized = normalizeSizeByCapability({
    ...requested,
    capability,
  });

  return {
    ...normalized,
    size: `${normalized.width}x${normalized.height}`,
    adjusted:
      normalized.width !== requested.width ||
      normalized.height !== requested.height,
    modelFamily: capability.family,
    sizePolicy: capability.sizePolicy,
  };
}

export function resolveLayeredDesignAlphaPolicy(params: {
  hasAlpha: boolean;
  model?: string;
  providerId?: string;
}): LayeredDesignAlphaPolicy {
  if (!params.hasAlpha) {
    return {
      requested: false,
      strategy: "none",
      postprocessRequired: false,
    };
  }

  const capability = resolveLayeredDesignImageModelCapability(
    params.model,
    params.providerId,
  );
  if (capability.supportsNativeTransparency === true) {
    return {
      requested: true,
      strategy: "provider_pipeline",
      postprocessRequired: false,
    };
  }

  if (capability.supportsNativeTransparency === false) {
    return {
      requested: true,
      strategy: "chroma_key_postprocess",
      chromaKeyColor: DEFAULT_CHROMA_KEY_COLOR,
      postprocessRequired: true,
    };
  }

  return {
    requested: true,
    strategy: "provider_pipeline",
    postprocessRequired: false,
  };
}

export function createLayeredDesignImageRuntimeContract(params: {
  documentId: string;
  request: LayeredDesignAssetGenerationRequest;
  model?: string;
  providerId?: string;
  taskSize: LayeredDesignImageTaskSize;
}): LayeredDesignImageRuntimeContract {
  const capability = resolveLayeredDesignImageModelCapability(
    params.model,
    params.providerId,
  );

  return {
    contract_key: "image_generation",
    layered_design: {
      document_id: params.documentId,
      layer_id: params.request.layerId,
      asset_id: params.request.assetId,
      model_family: params.taskSize.modelFamily,
      ...(params.providerId ? { provider_id: params.providerId } : {}),
      size_policy: params.taskSize.sizePolicy,
      requested_size: {
        width: roundPositive(params.request.width),
        height: roundPositive(params.request.height),
      },
      task_size: {
        width: params.taskSize.width,
        height: params.taskSize.height,
      },
      size_adjusted: params.taskSize.adjusted,
      capabilities: {
        native_transparency: capability.supportsNativeTransparency,
        image_edit: capability.supportsImageEdit,
        mask: capability.supportsMask,
        reference_images: capability.supportsReferenceImages,
      },
      alpha: resolveLayeredDesignAlphaPolicy({
        hasAlpha: params.request.hasAlpha,
        model: params.model,
        providerId: params.providerId,
      }),
    },
  };
}
