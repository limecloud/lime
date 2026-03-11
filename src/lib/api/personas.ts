import { invoke } from "@tauri-apps/api/core";
import type {
  CreatePersonaRequest,
  Persona,
  PersonaTemplate,
  PersonaUpdate,
} from "@/types/persona";

export async function listPersonas(projectId: string): Promise<Persona[]> {
  return invoke<Persona[]>("list_personas", { projectId });
}

export async function getDefaultPersona(
  projectId: string,
): Promise<Persona | null> {
  return invoke<Persona | null>("get_default_persona", { projectId });
}

export async function createPersona(
  request: CreatePersonaRequest,
): Promise<Persona> {
  return invoke<Persona>("create_persona", { req: request });
}

export async function updatePersona(
  id: string,
  update: PersonaUpdate,
): Promise<Persona> {
  return invoke<Persona>("update_persona", { id, update });
}

export async function deletePersona(id: string): Promise<void> {
  await invoke("delete_persona", { id });
}

export async function setDefaultPersona(
  projectId: string,
  personaId: string,
): Promise<void> {
  await invoke("set_default_persona", { projectId, personaId });
}

export async function listPersonaTemplates(): Promise<PersonaTemplate[]> {
  return invoke<PersonaTemplate[]>("list_persona_templates");
}
