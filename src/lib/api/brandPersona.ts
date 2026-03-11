import { invoke } from "@tauri-apps/api/core";
import type {
  BrandPersona,
  BrandPersonaExtension,
  BrandPersonaTemplate,
  CreateBrandExtensionRequest,
  UpdateBrandExtensionRequest,
} from "@/types/brand-persona";

export async function getBrandPersona(
  personaId: string,
): Promise<BrandPersona | null> {
  return invoke<BrandPersona | null>("get_brand_persona", { personaId });
}

export async function getBrandExtension(
  personaId: string,
): Promise<BrandPersonaExtension | null> {
  return invoke<BrandPersonaExtension | null>("get_brand_extension", {
    personaId,
  });
}

export async function saveBrandExtension(
  request: CreateBrandExtensionRequest,
): Promise<BrandPersonaExtension> {
  return invoke<BrandPersonaExtension>("save_brand_extension", {
    req: request,
  });
}

export async function updateBrandExtension(
  personaId: string,
  update: UpdateBrandExtensionRequest,
): Promise<BrandPersonaExtension> {
  return invoke<BrandPersonaExtension>("update_brand_extension", {
    personaId,
    update,
  });
}

export async function deleteBrandExtension(personaId: string): Promise<void> {
  await invoke("delete_brand_extension", { personaId });
}

export async function listBrandPersonaTemplates(): Promise<
  BrandPersonaTemplate[]
> {
  return invoke<BrandPersonaTemplate[]>("list_brand_persona_templates");
}
