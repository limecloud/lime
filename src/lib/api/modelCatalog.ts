import { safeInvoke } from "@/lib/dev-bridge";

export interface ModelInfo {
  id: string;
  object: string;
  owned_by: string;
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return safeInvoke("get_available_models");
}
