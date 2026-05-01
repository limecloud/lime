/**
 * @file voiceModels.ts
 * @description 本地语音模型管理 API
 */

import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { resolveOemCloudRuntimeContext } from "./oemCloudRuntime";
import { getAsrCredentials, type AsrCredentialEntry } from "./asrProvider";

export const VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT =
  "voice-model-download-progress";
export const DEFAULT_SENSEVOICE_MODEL_ID = "sensevoice-small-int8-2024-07-17";

export interface VoiceModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  description: string;
  version: string;
  languages: string[];
  size_bytes: number;
  download_url: string;
  vad_model_id?: string | null;
  vad_download_url?: string | null;
  runtime: string;
  bundled: boolean;
  checksum_sha256?: string | null;
}

export interface VoiceModelInstallState {
  model_id: string;
  installed: boolean;
  installing: boolean;
  install_dir: string;
  model_file?: string | null;
  tokens_file?: string | null;
  vad_file?: string | null;
  installed_bytes: number;
  last_verified_at?: number | null;
  missing_files: string[];
  default_credential_id?: string | null;
}

export interface VoiceModelDownloadResult {
  state: VoiceModelInstallState;
}

export type VoiceModelDownloadPhase =
  | "preparing"
  | "archive"
  | "extracting"
  | "vad"
  | "installing"
  | "done";

export interface VoiceModelDownloadProgressEvent {
  model_id: string;
  phase: VoiceModelDownloadPhase | string;
  downloaded_bytes: number;
  total_bytes?: number | null;
  overall_progress: number;
  message: string;
}

export interface VoiceModelTestTranscribeResult {
  text: string;
  duration_secs: number;
  sample_rate: number;
  language?: string | null;
}

export interface DefaultLocalVoiceModelReadiness {
  ready: boolean;
  model_id?: string | null;
  installed?: boolean;
  message?: string;
}

interface OemVoiceModelCatalogResponse {
  items?: OemVoiceModelCatalogItem[];
}

interface OemVoiceModelCatalogItem {
  id?: string;
  name?: string;
  provider?: string;
  description?: string;
  version?: string;
  languages?: string[];
  runtime?: string;
  bundled?: boolean;
  sizeBytes?: number;
  checksumSha256?: string | null;
  download?: {
    archive?: OemVoiceModelDownloadAsset;
    vad?: OemVoiceModelDownloadAsset | null;
  };
}

interface OemVoiceModelDownloadAsset {
  modelId?: string;
  downloadUrl?: string;
  sha256?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function unwrapEnvelope<T>(payload: unknown): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }

  return payload as T;
}

function mapOemVoiceModelCatalogItem(
  item: OemVoiceModelCatalogItem,
): VoiceModelCatalogEntry | null {
  const id = normalizeText(item.id);
  if (!id) {
    return null;
  }

  const archive = item.download?.archive;
  const vad = item.download?.vad ?? null;

  return {
    id,
    name: normalizeText(item.name) ?? id,
    provider: normalizeText(item.provider) ?? "FunAudioLLM / sherpa-onnx",
    description:
      normalizeText(item.description) ??
      "本地离线 ASR，模型按需下载到用户数据目录。",
    version: normalizeText(item.version) ?? "",
    languages: Array.isArray(item.languages) ? item.languages : [],
    size_bytes: typeof item.sizeBytes === "number" ? item.sizeBytes : 0,
    download_url: normalizeText(archive?.downloadUrl) ?? "",
    vad_model_id: normalizeText(vad?.modelId),
    vad_download_url: normalizeText(vad?.downloadUrl),
    runtime: normalizeText(item.runtime) ?? "sherpa-onnx",
    bundled: item.bundled === true,
    checksum_sha256:
      normalizeText(archive?.sha256) ?? normalizeText(item.checksumSha256),
  };
}

async function fetchOemVoiceModelCatalog(): Promise<
  VoiceModelCatalogEntry[] | null
> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    return null;
  }

  const response = await fetch(
    `${runtime.controlPlaneBaseUrl}/v1/public/tenants/${encodeURIComponent(
      runtime.tenantId,
    )}/client/voice-model-catalog`,
    {
      headers: {
        Accept: "application/json",
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `拉取语音模型目录失败 (${response.status})`;
    throw new Error(message);
  }

  const data = unwrapEnvelope<OemVoiceModelCatalogResponse>(payload);
  return (data.items ?? [])
    .map(mapOemVoiceModelCatalogItem)
    .filter((item): item is VoiceModelCatalogEntry => Boolean(item));
}

export async function listVoiceModelCatalog(): Promise<
  VoiceModelCatalogEntry[]
> {
  const oemCatalog = await fetchOemVoiceModelCatalog();
  if (oemCatalog) {
    return oemCatalog;
  }

  return safeInvoke<VoiceModelCatalogEntry[]>("voice_models_list_catalog");
}

export async function getVoiceModelInstallState(
  modelId: string,
): Promise<VoiceModelInstallState> {
  return safeInvoke<VoiceModelInstallState>("voice_models_get_install_state", {
    modelId,
  });
}

export async function getDefaultLocalVoiceModelReadiness(): Promise<DefaultLocalVoiceModelReadiness> {
  const credentials = await getAsrCredentials();
  const defaultCredential = credentials.find(
    (credential) => credential.is_default && !credential.disabled,
  );

  if (defaultCredential?.provider !== "sensevoice_local") {
    return { ready: true };
  }

  const modelId =
    normalizeText(defaultCredential.sensevoice_config?.model_id) ??
    DEFAULT_SENSEVOICE_MODEL_ID;
  const state = await getVoiceModelInstallState(modelId);
  if (state.installed) {
    return {
      ready: true,
      model_id: modelId,
      installed: true,
    };
  }

  return {
    ready: false,
    model_id: modelId,
    installed: false,
    message: "先下载语音模型",
  };
}

export async function downloadVoiceModel(
  modelId: string,
): Promise<VoiceModelDownloadResult> {
  const oemCatalog = await fetchOemVoiceModelCatalog();
  const catalogEntry = oemCatalog?.find((item) => item.id === modelId);
  return safeInvoke<VoiceModelDownloadResult>("voice_models_download", {
    modelId,
    ...(catalogEntry ? { catalogEntry } : {}),
  });
}

export async function listenVoiceModelDownloadProgress(
  callback: (event: VoiceModelDownloadProgressEvent) => void,
): Promise<() => void> {
  return safeListen<VoiceModelDownloadProgressEvent>(
    VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT,
    (event) => callback(event.payload),
  );
}

export async function deleteVoiceModel(
  modelId: string,
): Promise<VoiceModelInstallState> {
  return safeInvoke<VoiceModelInstallState>("voice_models_delete", {
    modelId,
  });
}

export async function setDefaultVoiceModel(
  modelId: string,
): Promise<AsrCredentialEntry> {
  return safeInvoke<AsrCredentialEntry>("voice_models_set_default", {
    modelId,
  });
}

export async function testTranscribeVoiceModelFile(
  modelId: string,
  filePath: string,
): Promise<VoiceModelTestTranscribeResult> {
  return safeInvoke<VoiceModelTestTranscribeResult>(
    "voice_models_test_transcribe_file",
    {
      modelId,
      filePath,
    },
  );
}
