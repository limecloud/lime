import { invoke } from "@tauri-apps/api/core";
import type {
  Material,
  MaterialFilter,
  MaterialType,
  MaterialUpdate,
  UploadMaterialRequest,
} from "@/types/material";

type RawMaterial = Partial<Material> & {
  material_type?: string;
  project_id?: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
  created_at?: number;
};

export interface ImportMaterialFromUrlRequest {
  projectId: string;
  name: string;
  type: MaterialType;
  url: string;
  tags?: string[];
  description?: string;
}

export interface ImportedMaterialRef {
  id: string;
}

const normalizeTimestampMs = (value?: number): number => {
  if (!value || Number.isNaN(value)) {
    return Date.now();
  }

  return value < 1_000_000_000_000 ? value * 1000 : value;
};

const buildUploadRequestPayload = (
  request: UploadMaterialRequest,
): Record<string, unknown> => ({
  projectId: request.projectId,
  project_id: request.projectId,
  name: request.name,
  type: request.type,
  filePath: request.filePath,
  file_path: request.filePath,
  content: request.content,
  tags: request.tags ?? [],
  description: request.description,
});

const buildImportRequestPayload = (
  request: ImportMaterialFromUrlRequest,
): Record<string, unknown> => ({
  projectId: request.projectId,
  project_id: request.projectId,
  name: request.name,
  type: request.type,
  url: request.url,
  tags: request.tags ?? [],
  description: request.description,
});

export function normalizeMaterial(
  material: RawMaterial,
  fallbackProjectId: string = "",
): Material {
  return {
    id: material.id ?? "",
    projectId: material.projectId ?? material.project_id ?? fallbackProjectId,
    name: material.name ?? "未命名素材",
    type: (material.type ??
      material.material_type ??
      "document") as MaterialType,
    filePath: material.filePath ?? material.file_path,
    fileSize: material.fileSize ?? material.file_size,
    mimeType: material.mimeType ?? material.mime_type,
    content: material.content,
    tags: material.tags ?? [],
    description: material.description,
    createdAt: normalizeTimestampMs(material.createdAt ?? material.created_at),
  };
}

export async function listMaterials(
  projectId: string,
  filter?: MaterialFilter | null,
): Promise<Material[]> {
  const materials = await invoke<RawMaterial[]>("list_materials", {
    projectId,
    project_id: projectId,
    filter: filter ?? null,
  });

  if (!Array.isArray(materials)) {
    console.warn("listMaterials 返回非数组值:", materials);
    return [];
  }

  return materials.map((material) => normalizeMaterial(material, projectId));
}

export async function getMaterialCount(projectId: string): Promise<number> {
  return invoke<number>("get_material_count", {
    projectId,
    project_id: projectId,
  });
}

export async function uploadMaterial(
  request: UploadMaterialRequest,
): Promise<Material> {
  const material = await invoke<RawMaterial>("upload_material", {
    req: buildUploadRequestPayload(request),
  });
  return normalizeMaterial(material, request.projectId);
}

export async function importMaterialFromUrl(
  request: ImportMaterialFromUrlRequest,
): Promise<ImportedMaterialRef> {
  return invoke<ImportedMaterialRef>("import_material_from_url", {
    req: buildImportRequestPayload(request),
  });
}

export async function updateMaterial(
  id: string,
  update: MaterialUpdate,
): Promise<Material> {
  const material = await invoke<RawMaterial>("update_material", {
    id,
    update,
  });
  return normalizeMaterial(material);
}

export async function deleteMaterial(id: string): Promise<void> {
  await invoke("delete_material", { id });
}

export async function getMaterialContent(id: string): Promise<string> {
  return invoke<string>("get_material_content", { id });
}
