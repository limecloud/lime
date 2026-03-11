import { getProject as getApiProject } from "@/lib/api/project";
import { toProjectView } from "@/lib/projectView";
import type { Project } from "@/types/project";

export interface ImageProviderOption {
  id: string;
  type: string;
  apiHost: string;
  customModels: string[];
}

export interface TtsProviderOption {
  id: string;
  type: string;
  apiHost: string;
  customModels: string[];
}

export interface VideoProviderOption {
  id: string;
  customModels: string[];
}

export interface WebImageSearchResponseForRail {
  total: number;
  provider: string;
  hits: Array<{
    id: string;
    name: string;
    content_url?: string;
    contentUrl?: string;
  }>;
}

export function getOptionLabel<TValue extends string>(
  options: Array<{ value: TValue; label: string }>,
  value: TValue,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function buildProviderEndpoint(
  apiHost: string,
  endpointPath: string,
): string {
  const trimmedHost = (apiHost || "").trim().replace(/\/+$/, "");
  const normalizedPath = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  return `${trimmedHost}${normalizedPath}`;
}

export function parseSimpleDuration(
  duration: string,
  fallbackValue: number,
): number {
  const value = Number.parseInt(duration.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(value) ? value : fallbackValue;
}

export function convertBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("当前环境不支持 FileReader"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("音频读取失败"));
    };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("音频读取结果为空"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}

export function revokeObjectUrlIfNeeded(url: string): void {
  if (
    url.startsWith("blob:") &&
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function"
  ) {
    URL.revokeObjectURL(url);
  }
}

export function tryParseJsonText(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractImageUrlsFromResponse(
  payload: Record<string, unknown> | null,
): string[] {
  const data = payload?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (url) {
        return url;
      }
      const b64 = typeof record.b64_json === "string" ? record.b64_json : "";
      if (!b64) {
        return "";
      }
      return `data:image/png;base64,${b64}`;
    })
    .filter((url) => url.length > 0);
}

export function extractAudioUrlFromResponse(
  payload: Record<string, unknown> | null,
): string {
  if (!payload) {
    return "";
  }

  const directUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  if (directUrl) {
    return directUrl;
  }

  const directB64 =
    typeof payload.b64_json === "string" ? payload.b64_json : "";
  if (directB64) {
    return `data:audio/mpeg;base64,${directB64}`;
  }

  const data = payload.data;
  if (!Array.isArray(data)) {
    return "";
  }

  for (const item of data) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const itemUrl = typeof record.url === "string" ? record.url.trim() : "";
    if (itemUrl) {
      return itemUrl;
    }
    const itemB64 = typeof record.b64_json === "string" ? record.b64_json : "";
    if (itemB64) {
      return `data:audio/mpeg;base64,${itemB64}`;
    }
  }

  return "";
}

export async function loadWorkbenchProject(
  projectId?: string | null,
): Promise<Project | null> {
  if (!projectId) {
    return null;
  }

  const project = await getApiProject(projectId);
  return project ? toProjectView(project) : null;
}
