import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";

export const COMPANION_PET_STATUS_EVENT = "companion-pet-status";
export const COMPANION_OPEN_PROVIDER_SETTINGS_EVENT =
  "companion-open-provider-settings";
export const COMPANION_REQUEST_PROVIDER_SYNC_EVENT =
  "companion-request-provider-sync";
export const COMPANION_REQUEST_PET_CHEER_EVENT = "companion-request-pet-cheer";
export const COMPANION_REQUEST_PET_NEXT_STEP_EVENT =
  "companion-request-pet-next-step";
export const COMPANION_REQUEST_PET_CHAT_EVENT = "companion-request-pet-chat";
export const COMPANION_REQUEST_PET_CHAT_RESET_EVENT =
  "companion-request-pet-chat-reset";
export const COMPANION_REQUEST_PET_VOICE_CHAT_EVENT =
  "companion-request-pet-voice-chat";
export const COMPANION_PET_VOICE_TRANSCRIPT_EVENT =
  "companion-pet-voice-transcript";
export const COMPANION_PROVIDER_OVERVIEW_CAPABILITY = "provider-overview";

export type CompanionPetVisualState =
  | "hidden"
  | "idle"
  | "walking"
  | "thinking"
  | "done";

export interface CompanionPetStatus {
  endpoint: string;
  server_listening: boolean;
  connected: boolean;
  client_id: string | null;
  platform: string | null;
  capabilities: string[];
  last_event: string | null;
  last_error: string | null;
  last_state: CompanionPetVisualState | null;
}

export interface CompanionLaunchPetRequest {
  app_path?: string | null;
  endpoint?: string | null;
  client_id?: string | null;
  protocol_version?: number | null;
}

export interface CompanionLaunchPetResult {
  launched: boolean;
  resolved_path: string | null;
  endpoint: string;
  message: string | null;
}

export interface CompanionPetCommandRequest<
  TPayload = Record<string, unknown>,
> {
  event: string;
  payload?: TPayload | null;
}

export interface CompanionPetSendResult {
  delivered: boolean;
  connected: boolean;
}

export interface CompanionPetChatRequestPayload {
  text: string;
  source?: string | null;
}

export interface CompanionPetLive2DActionPayload {
  expressions?: Array<number | string>;
  emotion_tags?: string[];
  motion_group?: string | null;
  motion_index?: number | null;
}

export async function getCompanionPetStatus(): Promise<CompanionPetStatus> {
  return safeInvoke<CompanionPetStatus>("companion_get_pet_status");
}

export async function launchCompanionPet(
  request: CompanionLaunchPetRequest = {},
): Promise<CompanionLaunchPetResult> {
  return safeInvoke<CompanionLaunchPetResult>("companion_launch_pet", {
    request,
  });
}

export async function sendCompanionPetCommand<
  TPayload = Record<string, unknown>,
>(
  request: CompanionPetCommandRequest<TPayload>,
): Promise<CompanionPetSendResult> {
  return safeInvoke<CompanionPetSendResult>("companion_send_pet_command", {
    request,
  });
}

export async function listenCompanionPetStatus(
  handler: (status: CompanionPetStatus) => void,
): Promise<UnlistenFn> {
  return safeListen<CompanionPetStatus>(COMPANION_PET_STATUS_EVENT, (event) => {
    handler(event.payload);
  });
}
