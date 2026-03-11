import { invoke } from "@tauri-apps/api/core";
import type {
  CreateTemplateRequest,
  Template,
  TemplateUpdate,
} from "@/types/template";

export async function listTemplates(projectId: string): Promise<Template[]> {
  return invoke<Template[]>("list_templates", { projectId });
}

export async function getDefaultTemplate(
  projectId: string,
): Promise<Template | null> {
  return invoke<Template | null>("get_default_template", { projectId });
}

export async function createTemplate(
  request: CreateTemplateRequest,
): Promise<Template> {
  return invoke<Template>("create_template", { req: request });
}

export async function updateTemplate(
  id: string,
  update: TemplateUpdate,
): Promise<Template> {
  return invoke<Template>("update_template", { id, update });
}

export async function deleteTemplate(id: string): Promise<void> {
  await invoke("delete_template", { id });
}

export async function setDefaultTemplate(
  projectId: string,
  templateId: string,
): Promise<void> {
  await invoke("set_default_template", { projectId, templateId });
}
