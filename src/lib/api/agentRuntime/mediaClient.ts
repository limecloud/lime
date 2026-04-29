import type {
  CreateAudioGenerationTaskArtifactRequest,
  CreateImageGenerationTaskArtifactRequest,
  ListMediaTaskArtifactsRequest,
  ListMediaTaskArtifactsOutput,
  MediaTaskArtifactOutput,
  MediaTaskLookupRequest,
} from "./types";
import {
  invokeAgentRuntimeBridge,
  type AgentRuntimeBridgeInvoke,
} from "./transport";

export interface AgentRuntimeMediaClientDeps {
  bridgeInvoke?: AgentRuntimeBridgeInvoke;
}

export function createMediaClient({
  bridgeInvoke = invokeAgentRuntimeBridge,
}: AgentRuntimeMediaClientDeps = {}) {
  async function createImageGenerationTaskArtifact(
    request: CreateImageGenerationTaskArtifactRequest,
  ): Promise<MediaTaskArtifactOutput> {
    return await bridgeInvoke("create_image_generation_task_artifact", {
      request,
    });
  }

  async function createAudioGenerationTaskArtifact(
    request: CreateAudioGenerationTaskArtifactRequest,
  ): Promise<MediaTaskArtifactOutput> {
    return await bridgeInvoke("create_audio_generation_task_artifact", {
      request,
    });
  }

  async function getMediaTaskArtifact(
    request: MediaTaskLookupRequest,
  ): Promise<MediaTaskArtifactOutput> {
    return await bridgeInvoke("get_media_task_artifact", { request });
  }

  async function listMediaTaskArtifacts(
    request: ListMediaTaskArtifactsRequest,
  ): Promise<ListMediaTaskArtifactsOutput> {
    return await bridgeInvoke("list_media_task_artifacts", {
      request,
    });
  }

  async function cancelMediaTaskArtifact(
    request: MediaTaskLookupRequest,
  ): Promise<MediaTaskArtifactOutput> {
    return await bridgeInvoke("cancel_media_task_artifact", {
      request,
    });
  }

  return {
    cancelMediaTaskArtifact,
    createAudioGenerationTaskArtifact,
    createImageGenerationTaskArtifact,
    getMediaTaskArtifact,
    listMediaTaskArtifacts,
  };
}

export const {
  cancelMediaTaskArtifact,
  createAudioGenerationTaskArtifact,
  createImageGenerationTaskArtifact,
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
} = createMediaClient();
