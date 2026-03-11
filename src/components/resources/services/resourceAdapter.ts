import {
  createContent,
  deleteContent,
  getContent,
  listContents,
  updateContent,
  type ContentListItem,
} from "@/lib/api/project";
import {
  deleteMaterial,
  listMaterials,
  updateMaterial,
  uploadMaterial,
} from "@/lib/api/materials";
import type { Material, MaterialType } from "@/types/material";
import type { ResourceItem, ResourceMetadata } from "./types";

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "m4a", "ogg", "flac"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "flv"]);

const DATA_EXTENSIONS = new Set(["csv", "json", "xml", "xlsx", "xls"]);

const TEXT_EXTENSIONS = new Set(["txt", "md"]);

const KNOWN_MATERIAL_TYPES = new Set<MaterialType>([
  "document",
  "image",
  "audio",
  "video",
  "text",
  "data",
  "link",
  "icon",
  "color",
  "layout",
]);

const toTimestampMs = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) {
    return Date.now();
  }
  // 部分旧数据可能是秒级时间戳
  return value < 1_000_000_000_000 ? value * 1000 : value;
};

const parseResourceMetadata = (value: unknown): ResourceMetadata => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { parentId: null, resourceKind: "document" };
  }

  const metadata = value as Record<string, unknown>;
  const parentId =
    typeof metadata.parentId === "string" && metadata.parentId.trim().length > 0
      ? metadata.parentId
      : null;
  const resourceKind =
    metadata.resourceKind === "folder" ? "folder" : "document";

  return {
    ...metadata,
    parentId,
    resourceKind,
  };
};

const getPathExtension = (value: string | undefined): string => {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() || normalized;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
};

const inferMaterialTypeFromMime = (
  mimeType: string | undefined,
): MaterialType | null => {
  const normalized = mimeType?.toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("text/")) return "text";
  if (
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("spreadsheet")
  ) {
    return "data";
  }

  return null;
};

const normalizeMaterialType = (
  rawMaterialType: string | undefined,
  mimeType: string | undefined,
  filePath: string | undefined,
  fileName: string,
): MaterialType => {
  const normalizedRaw = rawMaterialType?.toLowerCase().trim();
  if (
    normalizedRaw &&
    KNOWN_MATERIAL_TYPES.has(normalizedRaw as MaterialType)
  ) {
    return normalizedRaw as MaterialType;
  }

  const mimeInferred = inferMaterialTypeFromMime(mimeType);
  if (mimeInferred) {
    return mimeInferred;
  }

  const extension =
    getPathExtension(filePath) || getPathExtension(fileName) || "";
  if (!extension) {
    return "document";
  }

  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (DATA_EXTENSIONS.has(extension)) return "data";
  if (TEXT_EXTENSIONS.has(extension)) return "text";

  return "document";
};

const mapContentToResource = (item: ContentListItem): ResourceItem | null => {
  const metadata = parseResourceMetadata(item.metadata);

  return {
    id: item.id,
    projectId: item.project_id,
    name: item.title,
    kind: metadata.resourceKind === "folder" ? "folder" : "document",
    sourceType: "content",
    parentId: metadata.parentId ?? null,
    createdAt: toTimestampMs(item.created_at),
    updatedAt: toTimestampMs(item.updated_at),
    size: item.word_count,
    metadata,
  };
};

const mapMaterialToResource = (
  item: Material,
  fallbackProjectId: string,
): ResourceItem => {
  const name = item.name ?? "未命名文件";
  const filePath = item.filePath;
  const mimeType = item.mimeType;
  const materialType = normalizeMaterialType(
    item.type?.toString(),
    mimeType,
    filePath,
    name,
  );
  const projectId = (item.projectId || fallbackProjectId).toString();

  return {
    id: item.id,
    projectId,
    name,
    kind: "file",
    sourceType: "material",
    parentId: null,
    createdAt: toTimestampMs(item.createdAt),
    updatedAt: toTimestampMs(item.createdAt),
    size: item.fileSize,
    fileType: materialType,
    mimeType,
    filePath,
    description: item.description,
    tags: item.tags ?? [],
  };
};

const extractFileName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  const name = normalized.split("/").pop();
  return name && name.trim().length > 0 ? name.trim() : "未命名文件";
};

const inferMaterialType = (filePath: string): MaterialType => {
  const extension = getPathExtension(filePath);
  if (!extension) {
    return "document";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (DATA_EXTENSIONS.has(extension)) {
    return "data";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return "document";
};

export const fetchProjectResources = async (
  projectId: string,
): Promise<ResourceItem[]> => {
  const [contents, materials] = await Promise.all([
    listContents(projectId, {
      sort_by: "updated_at",
      sort_order: "desc",
    }),
    listMaterials(projectId),
  ]);

  const contentResources = contents
    .map(mapContentToResource)
    .filter((item): item is ResourceItem => Boolean(item));
  const materialResources = materials.map((item) =>
    mapMaterialToResource(item, projectId),
  );

  return [...contentResources, ...materialResources];
};

export const createFolderResource = async (
  projectId: string,
  name: string,
  parentId: string | null,
): Promise<void> => {
  await createContent({
    project_id: projectId,
    title: name,
    content_type: "document",
    metadata: {
      parentId,
      resourceKind: "folder",
    },
  });
};

export const createDocumentResource = async (
  projectId: string,
  name: string,
  parentId: string | null,
): Promise<void> => {
  await createContent({
    project_id: projectId,
    title: name,
    content_type: "document",
    body: "",
    metadata: {
      parentId,
      resourceKind: "document",
    },
  });
};

export const renameResource = async (
  item: ResourceItem,
  name: string,
): Promise<void> => {
  if (item.sourceType === "material") {
    await updateMaterial(item.id, { name });
    return;
  }

  await updateContent(item.id, { title: name });
};

export const deleteSingleResource = async (
  item: ResourceItem,
): Promise<void> => {
  if (item.sourceType === "material") {
    await deleteMaterial(item.id);
    return;
  }

  await deleteContent(item.id);
};

export const moveContentResource = async (
  item: ResourceItem,
  parentId: string | null,
): Promise<void> => {
  if (item.sourceType !== "content") {
    return;
  }

  const metadata: ResourceMetadata = {
    ...(item.metadata ?? {}),
    resourceKind: item.kind === "folder" ? "folder" : "document",
    parentId,
  };

  await updateContent(item.id, {
    metadata: metadata as Record<string, unknown>,
  });
};

export const uploadFileResource = async (
  projectId: string,
  filePath: string,
): Promise<void> => {
  await uploadMaterial({
    projectId,
    name: extractFileName(filePath),
    type: inferMaterialType(filePath),
    filePath,
    tags: [],
  });
};

export const fetchDocumentDetail = async (id: string) => {
  return getContent(id);
};
