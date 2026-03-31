import { safeInvoke } from "@/lib/dev-bridge";
import type {
  ColorMood,
  CreateGalleryMetadataRequest,
  GalleryMaterial,
  GalleryMaterialMetadata,
  ImageCategory,
  LayoutCategory,
} from "@/types/gallery-material";

export async function getGalleryMaterial(
  materialId: string,
): Promise<GalleryMaterial | null> {
  return safeInvoke<GalleryMaterial | null>("get_gallery_material", {
    materialId,
  });
}

export async function createGalleryMetadata(
  request: CreateGalleryMetadataRequest,
): Promise<GalleryMaterialMetadata> {
  return safeInvoke<GalleryMaterialMetadata>("create_gallery_material_metadata", {
    req: request,
  });
}

export async function updateGalleryMetadata(
  materialId: string,
  request: CreateGalleryMetadataRequest,
): Promise<GalleryMaterialMetadata> {
  return safeInvoke<GalleryMaterialMetadata>("update_gallery_material_metadata", {
    materialId,
    req: request,
  });
}

export async function deleteGalleryMetadata(materialId: string): Promise<void> {
  await safeInvoke<void>("delete_gallery_material_metadata", { materialId });
}

export async function listGalleryMaterialsByImageCategory(
  projectId: string,
  category?: ImageCategory | null,
): Promise<GalleryMaterial[]> {
  return safeInvoke<GalleryMaterial[]>("list_gallery_materials_by_image_category", {
    projectId,
    category: category ?? null,
  });
}

export async function listGalleryMaterialsByLayoutCategory(
  projectId: string,
  category?: LayoutCategory | null,
): Promise<GalleryMaterial[]> {
  return safeInvoke<GalleryMaterial[]>("list_gallery_materials_by_layout_category", {
    projectId,
    category: category ?? null,
  });
}

export async function listGalleryMaterialsByMood(
  projectId: string,
  mood?: ColorMood | null,
): Promise<GalleryMaterial[]> {
  return safeInvoke<GalleryMaterial[]>("list_gallery_materials_by_mood", {
    projectId,
    mood: mood ?? null,
  });
}
